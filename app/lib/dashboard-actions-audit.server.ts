/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
/**
 * App on/off and audit start/stop.
 *
 * These handlers are the single implementation behind both the merchant
 * dashboard action (`app._index.jsx`) and the admin-panel control plane
 * (`api.internal.store-control.jsx`). Pass `activityMeta` (for example
 * `{ by: "admin-panel", actor }`) to attribute the activity-log row.
 */

import prisma from "../db.server";
import { startAuditForStore } from "./audit-runner.server";
import { getPasswordProtection } from "./password-protection.server";
import { isAppEmbedEnabled, getAppEmbedDeepLink, getSelectedThemeId } from "./theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";
import { safeUpdateConfig, safeSyncConfig, safeLogActivity } from "./dashboard-helpers.server.ts";
import { stopAuditForShop } from "./audit-watchdog.server";
import { rebuildPerformanceScript } from "./performance-script.server";

const PASSWORD_CHECK_TIMEOUT_MS = 10_000;

/** `{ ok: false, error: "extension_required", ... }` for a theme without the app embed. */
function extensionRequired(shop: any, selectedThemeId: any, extra = {}) {
  return {
    ok: false,
    error: "extension_required",
    embedActivateUrl: getAppEmbedDeepLink(shop, undefined, undefined, selectedThemeId),
    ...extra,
  };
}

/**
 * Turns the app on or off.
 *
 * `forceAppOn` (admin only) skips the embed and password guards.
 */
export async function handleToggleApp({
  admin,
  session,
  formData,
  forceAppOn = false,
  activityMeta = {},
}: any) {
  const shop = session?.shop;
  if (!shop) return { ok: false, error: "missing_shop" };
  const appEnabled = formData.get("appEnabled") === "true";

  // Captured BEFORE the write, so the auto re-run below fires on OFF -> ON only.
  const wasEnabled = await prisma.storeConfig
    .findFirst({
      where: { store: { shopDomain: shop } },
      select: { appEnabled: true },
    })
    .then((row: any) => row?.appEnabled === true)
    .catch(() => false);

  if (appEnabled && !forceAppOn) {
    // The embed must be on in the theme the merchant selected (live theme
    // when none is selected).
    const selectedThemeId = await getSelectedThemeId(shop).catch(() => null);
    const embedCheck = await isAppEmbedEnabled(admin, undefined, selectedThemeId);
    if (embedCheck !== true) {
      return extensionRequired(shop, selectedThemeId, {
        embedEnabled: false,
        config: { appEnabled: false },
      });
    }

    // Defense-in-depth: re-check password protection even though
    // /api/toggle-validate already did client-side. The server is the last
    // line of defense before the app actually turns on.
    try {
      // Stored answer if there is one, otherwise a live check (the client
      // shows its "validating" spinner meanwhile).
      const isPasswordProtected = await withShopifyTimeout(
        getPasswordProtection(admin, shop),
        "passwordProtection",
        PASSWORD_CHECK_TIMEOUT_MS,
      );
      if (isPasswordProtected === true) {
        const store = await prisma.store.findUnique({
          where: { shopDomain: shop },
          select: { configs: { select: { storefrontPassword: true } } },
        });
        if (!store?.configs?.[0]?.storefrontPassword) {
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

  // Enabling the app turns all 3 scripts ON by default (the user can then
  // switch individual scripts off in Step 2). Disabling only flips the master
  // switch, so individual choices are preserved for re-enable.
  const config = await safeUpdateConfig(admin, {
    appEnabled,
    ...(appEnabled ? { script1Enabled: true, script2Enabled: true, script3Enabled: true } : {}),
  });

  await safeSyncConfig(shop, config);
  // appEnabled just changed in the DB: rebuild the stored storefront script
  // (empty when OFF). The audit rebuilds it again once it completes.
  await rebuildPerformanceScript(shop);
  await safeLogActivity(shop, "config_changed", `App ${appEnabled ? "enabled" : "disabled"}`, {
    changedFields: ["appEnabled"],
    ...activityMeta,
  });

  if (!appEnabled) {
    // An audit measures a storefront that no longer serves the gate.
    await stopAuditForShop(shop).catch((err) => {
      console.warn("[toggle-app] stop audit on disable:", err instanceof Error ? err.message : err);
    });
  }

  // Turning the app ON from OFF re-runs the audit automatically: a storefront
  // that was serving an empty gate has never been measured, so the stored
  // script would otherwise be built from an old audit. OFF -> ON only, so
  // re-enabling repeatedly never spawns a run each time. Fire-and-forget:
  // the toggle is not delayed by the run.
  let auditStarted = false;
  if (appEnabled && !wasEnabled) {
    try {
      const { started } = await startAuditForStore(admin, shop);
      auditStarted = started === true;
    } catch (err) {
      // Never fail the toggle because the audit could not start: the app is
      // enabled and the merchant can still press "Run audit" manually.
      console.error("[toggle-app] auto audit start failed:", err);
    }
  }

  // Sticky first-activation flag: any successful enable (auto or manual) must
  // prevent maybeFirstActivation from flipping the app back ON later.
  if (appEnabled) {
    await prisma.storeConfig
      .updateMany({
        where: { store: { shopDomain: shop }, onboardingActivated: false },
        data: { onboardingActivated: true },
      })
      .catch((err: unknown) => {
        console.warn(
          "[toggle-app] onboardingActivated update failed:",
          err instanceof Error ? err.message : err,
        );
      });
  }

  return {
    ok: true,
    config,
    auditStarted,
    forcedOnWithoutEmbed: forceAppOn && appEnabled,
  };
}

export async function handleStopAudit({ session, activityMeta = {} }: any) {
  const result = await stopAuditForShop(session.shop);
  if (!result.ok) {
    return { ok: false, error: result.error || "stop_failed" };
  }
  await safeLogActivity(session.shop, "config_changed", "Audit stopped", {
    changedFields: ["auditRunning"],
    ...activityMeta,
  });
  return { ok: true, auditStopped: true };
}

/**
 * Explicit audit start. This is the only way a run begins besides the
 * OFF -> ON toggle, so it carries every guard: the app must be ON, no run may
 * already be in flight, and the theme app embed must be confirmed installed
 * (the audit scans the storefront, which only carries the gate with the
 * embed on).
 */
export async function handleStartAudit({ admin, session, activityMeta = {} }: any) {
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

  const config = store.configs[0];
  if (!config?.appEnabled) return { ok: false, error: "app_disabled" };

  // One run at a time: a second call would spawn a concurrent Chromium run
  // and only the newer generation would be allowed to write.
  if (config.auditRunning) return { ok: false, error: "already_running" };

  const selectedThemeId = await getSelectedThemeId(session.shop).catch(() => null);
  const embedCheck = await isAppEmbedEnabled(admin, undefined, selectedThemeId);
  if (embedCheck !== true) {
    return extensionRequired(session.shop, selectedThemeId);
  }

  // `startAuditForStore` resets the run state itself (auditRunning,
  // auditComplete, auditPages, auditPageIndex) before Chromium launches, so
  // one call covers both the first run and a re-run.
  try {
    const { started, reason } = await startAuditForStore(admin, session.shop);
    if (!started) {
      return {
        ok: false,
        error: reason === "already_running" ? "already_running" : "start_failed",
      };
    }
    await safeLogActivity(session.shop, "config_changed", "Audit started manually", {
      changedFields: ["auditRunning"],
      ...activityMeta,
    });
    return { ok: true, auditStarted: true };
  } catch (err) {
    console.error("[Dashboard] Failed to start audit:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      error: "Failed to start the audit. " + (err instanceof Error ? err.message : ""),
    };
  }
}
