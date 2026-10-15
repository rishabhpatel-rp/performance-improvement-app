import prisma from "../db.server";
import { startAuditForStore } from "./audit-runner.server";
import { getPasswordProtection } from "./password-protection.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
  getSelectedThemeId,
} from "./theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";
import {
  safeUpdateConfig,
  safeSyncConfig,
  safeLogActivity,
} from "./dashboard-helpers.server.js";
import { stopAuditForShop } from "./audit-watchdog.server";
import { rebuildPerformanceScript } from "./performance-script.server";

export async function handleToggleApp({ admin, session, formData }) {
const appEnabled = formData.get("appEnabled") === "true";
// Captured BEFORE the write, so the auto re-run below fires on OFF -> ON only.
const wasEnabled = await prisma.storeConfig
  .findFirst({
    where: { store: { shopDomain: session.shop } },
    select: { appEnabled: true },
  })
  .then((r) => r?.appEnabled === true)
  .catch(() => false);

if (appEnabled) {
  // The embed must be on in the theme the merchant selected (live theme
  // when none is selected).
  const selectedThemeId = await getSelectedThemeId(session.shop).catch(
    () => null,
  );
  const embedCheck = await isAppEmbedEnabled(
    admin,
    undefined,
    selectedThemeId,
  );
  if (embedCheck !== true) {
    return {
      ok: false,
      error: "extension_required",
      embedEnabled: false,
      embedActivateUrl: getAppEmbedDeepLink(
        session.shop,
        undefined,
        undefined,
        selectedThemeId,
      ),
      config: { appEnabled: false },
    };
  }

  // Defense-in-depth: re-check password protection here too, even
  // though /api/toggle-validate already checked it client-side. This
  // guards against a bypassed/skipped client validation call or stale
  // client state — the server is the last line of defense before the
  // app actually turns on.
  try {
    // Stored answer if there is one, otherwise a live check (up to 10 s;
    // the client shows its "validating" spinner meanwhile).
    const isPasswordProtected = await withShopifyTimeout(
      getPasswordProtection(admin, session.shop),
      "passwordProtection",
      10000,
    );

    if (isPasswordProtected === true) {
      const store = await prisma.store.findUnique({
        where: { shopDomain: session.shop },
        select: { configs: { select: { storefrontPassword: true } } },
      });
      const savedPassword = store?.configs?.[0]?.storefrontPassword || "";
      if (!savedPassword) {
        return {
          ok: false,
          error: "password_required",
          config: { appEnabled: false },
        };
      }
    }
  } catch (err) {
    rethrowAuthRedirect(err);
    // Could not tell: do not block. If the store is protected after all,
    // the audit stops with PASSWORD_REQUIRED and asks for the password.
    console.warn(
      "[Dashboard] toggle-app password check inconclusive:",
      err instanceof Error ? err.message : err,
    );
  }
}

// Enabling the app turns all 3 scripts ON by default (user can then
// switch individual scripts off in Step 2). Disabling the app just flips
// the master switch — individual choices are preserved for re-enable.
const config = await safeUpdateConfig(admin, {
  appEnabled,
  ...(appEnabled
    ? {
        script1Enabled: true,
        script2Enabled: true,
        script3Enabled: true,
      }
    : {}),
});

// NOTE: turning the app ON/OFF deliberately does NOT start or clear an
// audit. The audit is expensive (three pages through a headless browser,
// ~1-2 minutes) and its results are independent of the master switch, so
// the merchant starts it explicitly from Step 1 and the results survive
// every toggle. Turning the app OFF still serves an empty storefront
// script immediately — `rebuildPerformanceScript` below gates on
// `appEnabled`, and `api.storefront-scripts` re-checks it on every
// request — so no audit state needs to be wiped for safety.

await safeSyncConfig(session.shop, config);
// appEnabled just changed in the DB: rebuild the stored storefront script
// (empty when OFF). The audit rebuilds it again once it completes.
await rebuildPerformanceScript(session.shop);
await safeLogActivity(
  session.shop,
  "config_changed",
  `App ${appEnabled ? "enabled" : "disabled"}`,
  { changedFields: ["appEnabled"] },
);

if (!appEnabled) {
  await stopAuditForShop(session.shop).catch((err) => {
    console.warn(
      "[toggle-app] stop audit on disable:",
      err instanceof Error ? err.message : err,
    );
  });
}

// Turning the app ON from OFF re-runs the audit automatically. A storefront
// that was serving an empty gate has never been measured, so the stored
// script does not reflect the current theme; leaving it stale would serve a
// bundle built from an old audit. OFF -> ON only: re-enabling repeatedly must
// not spawn a run each time, and turning OFF never starts one.
//
// startAuditForStore resets the run state itself, so one call covers both a
// first-ever enable and a re-enable. It is fire-and-forget, so the toggle is
// not delayed by the run.
let auditStarted = false;
if (appEnabled && !wasEnabled) {
  try {
    const { started } = await startAuditForStore(admin, session.shop);
    auditStarted = started === true;
  } catch (err) {
    // Never fail the toggle because the audit could not start: the app is
    // enabled and the merchant can still press "Run audit" manually.
    console.error("[toggle-app] auto audit start failed:", err);
  }
}

// Returned rather than inferred on the client, so the extension and password
// checks above are never bypassed by an optimistic start.
return { ok: true, config, auditStarted };
}

export async function handleStopAudit({ session }) {
const result = await stopAuditForShop(session.shop);
if (!result.ok) {
  return { ok: false, error: result.error || "stop_failed" };
}
await safeLogActivity(
  session.shop,
  "config_changed",
  "Audit stopped by merchant",
  { changedFields: ["auditRunning"] },
);
return { ok: true, auditStopped: true };
}

export async function handleStartAudit({ admin, session }) {
const store = await prisma.store.findUnique({
  where: { shopDomain: session.shop },
  select: {
    id: true,
    configs: {
      select: { appEnabled: true, auditRunning: true },
      orderBy: { updatedAt: "desc" },
      take: 1,
    },
  },
});
if (!store) return { ok: false, error: "Store record not found." };

const sc = store.configs[0];
if (!sc?.appEnabled) {
  return { ok: false, error: "app_disabled" };
}

const selectedThemeId = await getSelectedThemeId(session.shop).catch(
  () => null,
);
const embedCheck = await isAppEmbedEnabled(
  admin,
  undefined,
  selectedThemeId,
);
if (embedCheck !== true) {
  return {
    ok: false,
    error: "extension_required",
    embedActivateUrl: getAppEmbedDeepLink(
      session.shop,
      undefined,
      undefined,
      selectedThemeId,
    ),
  };
}

// `startAuditForStore` resets the run state itself (auditRunning,
// auditComplete, auditPages, auditPageIndex) before Chromium launches, so
// this one call covers both the first run and a re-run.
try {
  const { started, reason } = await startAuditForStore(admin, session.shop);
  if (!started) {
    return { ok: false, error: reason || "not_started" };
  }
  await safeLogActivity(
    session.shop,
    "config_changed",
    "Audit started manually",
    { changedFields: ["auditRunning"] },
  );
  return { ok: true, auditStarted: true };
} catch (err) {
  console.error(
    "[Dashboard] Failed to start audit:",
    err instanceof Error ? err.message : err,
  );
  return {
    ok: false,
    error: "Failed to start the audit. " + (err instanceof Error ? err.message : ""),
  };
}
}
