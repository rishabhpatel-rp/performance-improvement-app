import { useState, useEffect, useRef, useCallback } from "react";
import { useLoaderData, useFetchers, useRouteError, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// Request-scoped key for caching auth result (must match app.jsx)
const AUTH_CACHE_KEY = "__pagepulse_admin_auth__";
import {
  ensureConfig,
  ensureAppEndpoint,
  updateConfig,
} from "../lib/metaobjects";
import {
  fetchShopDetailsFromShopify,
  upsertStore,
  syncConfigToDatabase,
  logActivity,
  readStringArray,
  readAuditPages,
  updateAuditArrays,
  updateAuditFieldToggle,
} from "../lib/store-sync.server";
import { startAuditForStore } from "../lib/audit-runner.server";
import { normalizeCustomUrl } from "../lib/page-urls.server";
import { rebuildPerformanceScript } from "../lib/performance-script.server";
import {
  getPasswordProtection,
  refreshPasswordProtection,
} from "../lib/password-protection.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
  getSelectedThemeId,
  listThemes,
} from "../lib/theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "../lib/shopify-timeout.server";
import prisma from "../db.server";
import { usePasswordStatus } from "../lib/use-password-status";
import WizardProgress from "../components/WizardProgress";
import Step1Activate from "../components/Step1Activate";
import Step2Configure from "../components/Step2Configure";
import WizardNavigation from "../components/WizardNavigation";
import FooterBranding from "../components/FooterBranding";

const DEFAULT_CONFIG = {
  appEnabled: false,
  script1Enabled: false,
  script2Enabled: false,
  script3Enabled: false,
  scriptTitles: ["", "", ""],
  debugMode: false,
  auditDeferArray: [],
  auditHideSelectors: [],
  staticDeferDefaults: ["wpm","gtm"],
  auditDeferArrayEnabled: true,
  auditHideSelectorsEnabled: true,
  staticDeferDefaultsEnabled: true,
  auditDeferArrayPreserved: [],
  auditHideSelectorsPreserved: [],
  staticDeferDefaultsPreserved: [],
  auditComplete: false,
  appEndpoint: "",
  storefrontPassword: "",

  // NEW
  firstUserDelayScripts: ["wpm","gtm"],
  firstUserDelayScriptsEnabled: true,
  firstUserDelayScriptsPreserved: [],
  firstUserDelayMs: 12000,
  everyTimeDelayMs: 6000,
};

async function safeUpdateConfig(admin, input) {
  try {
    return await updateConfig(admin, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No metaobject definition exists")) {
      console.warn(
        "[Dashboard] Metaobject definition not deployed. " +
          "Run shopify app config push. Returning defaults.",
      );
      return { ...DEFAULT_CONFIG, ...input };
    }
    throw err;
  }
}

// Persists the merged metaobject config into PostgreSQL for the given shop
// and swallows/logs any failure so a DB hiccup never breaks the dashboard.
async function safeSyncConfig(shop, config) {
  try {
    await syncConfigToDatabase(shop, {
      appEnabled: config.appEnabled,
      script1Enabled: config.script1Enabled,
      script2Enabled: config.script2Enabled,
      script3Enabled: config.script3Enabled,
      debugMode: config.debugMode,
      auditComplete: config.auditComplete,
      scriptTitles: config.scriptTitles,
      auditDeferArray: config.auditDeferArray,
      auditHideSelectors: config.auditHideSelectors,
    });
  } catch (err) {
    console.error(
      "[Dashboard] DB sync failed:",
      err instanceof Error ? err.message : err,
    );
  }
}

async function safeLogActivity(shop, eventType, description, metadata) {
  try {
    await logActivity(shop, eventType, description, metadata);
  } catch (err) {
    console.error(
      "[Dashboard] Failed to log activity:",
      err instanceof Error ? err.message : err,
    );
  }
}

// The theme app embed is definitely off but the app is still recorded as
// enabled: persist OFF (DB + metaobject) so Shopify, Postgres and the admin
// panel agree with the toggle the merchant sees. Best-effort — failures are
// logged and swallowed. Never call this for an *unknown* embed status.
async function disableAppBecauseEmbedOff({ admin, session, store }) {
  try {
    if (store?.id) {
      await prisma.storeConfig.update({
        where: { storeId: store.id },
        data: { appEnabled: false },
      });
    }
    await withShopifyTimeout(
      safeUpdateConfig(admin, { appEnabled: false }),
      "autoDisableConfig",
    );
    await rebuildPerformanceScript(session.shop);
    await safeLogActivity(
      session.shop,
      "config_changed",
      "App auto-disabled: theme app embed is off",
      { changedFields: ["appEnabled"], reason: "embed_disabled" },
    );
  } catch (err) {
    rethrowAuthRedirect(err);
    console.error(
      "[Dashboard] Failed to persist auto-disable:",
      err instanceof Error ? err.message : err,
    );
  }
}

const STORE_CONFIG_SELECT = {
  appEnabled: true,
  script1Enabled: true,
  script2Enabled: true,
  script3Enabled: true,
  debugMode: true,
  scriptTitles: true,
  auditComplete: true,
  auditRunning: true,
  auditFailed: true,
  auditError: true,
  auditPageIndex: true,
  auditTotalPages: true,
  auditPages: true,
  auditPageStartedAt: true,
  selectedThemeId: true,
  storefrontPassword: true,
  customPlpUrl: true,
  customPdpUrl: true,
  auditDeferArray: true,
  auditHideSelectors: true,
  staticDeferDefaults: true,
  auditDeferArrayEnabled: true,
  auditHideSelectorsEnabled: true,
  staticDeferDefaultsEnabled: true,
  auditDeferArrayPreserved: true,
  auditHideSelectorsPreserved: true,
  staticDeferDefaultsPreserved: true,
  // NEW
  firstUserDelayScripts: true,
  firstUserDelayScriptsEnabled: true,
  firstUserDelayScriptsPreserved: true,
  firstUserDelayMs: true,
  everyTimeDelayMs: true,
  // NEW: Cached values for fast path
  isPasswordProtected: true,
  cachedAppEndpoint: true,
    // Read by the loader below. Without these in the SELECT, `sc.lastAuditAt`
    // is always undefined (so `auditHasRun` is permanently false and the
    // "DB is authoritative" array merge silently degrades to a length guard)
    // and `sc.auditPhase` is always null (so Step 1 shows "discovering" on
    // first paint regardless of the real phase).
    lastAuditAt: true,
    auditPhase: true,
};

function emptyAuditStatus() {
  return {
    running: false,
    complete: false,
    failed: false,
    error: null,
    pageIndex: 0,
    totalPages: 0,
    progress: 0,
    pages: [],
    pageStartedAt: null,
    phase: null,
    serverNow: Date.now(),
  };
}

function configFromDbRow(sc) {
  if (!sc) return null;
  return {
    appEnabled: sc.appEnabled,
    script1Enabled: sc.script1Enabled,
    script2Enabled: sc.script2Enabled,
    script3Enabled: sc.script3Enabled,
    debugMode: sc.debugMode,
    scriptTitles: readStringArray(sc.scriptTitles),
    auditComplete: sc.auditComplete,
    auditDeferArray: readStringArray(sc.auditDeferArray),
    auditHideSelectors: readStringArray(sc.auditHideSelectors),
    staticDeferDefaults: readStringArray(sc.staticDeferDefaults),
  };
}

export const loader = async ({ request }) => {
  const loaderStarted = Date.now();

  // Use cached auth from parent layout loader (one auth on paint path)
  const cached = request[AUTH_CACHE_KEY];
  if (!cached) {
    // Fallback: if no cache, we need to authenticate (first open, or direct navigation)
    const { admin, session } = await authenticate.admin(request);
    request[AUTH_CACHE_KEY] = { admin, session };
  }
  const { admin, session } = request[AUTH_CACHE_KEY];

  // eslint-disable-next-line no-undef
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const endpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";

  // Check if we can use fast path: Store exists AND isActive=true
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      isActive: true,
      lastSyncedAt: true,
      configs: { select: STORE_CONFIG_SELECT },
    },
  });

  const hasActiveStore = store?.isActive === true;
  const sc = store?.configs?.[0];
  const selectedThemeId = sc?.selectedThemeId ?? null;

  // Always re-check the theme app embed (fast path included), in parallel with
  // the Shopify calls below. It targets the theme the merchant picked (live
  // theme when none). true = enabled, false = definitely off, null = unknown
  // (error / timeout) — treated as OFF by the toggle.
  const embedPromise = withShopifyTimeout(
    isAppEmbedEnabled(admin, undefined, selectedThemeId),
    "isAppEmbedEnabled",
  ).catch((err) => {
    rethrowAuthRedirect(err);
    console.error(
      "[Dashboard] Failed to read embed status:",
      err instanceof Error ? err.message : err,
    );
    return null;
  });
  // The auth-redirect Response is re-thrown when embedPromise is awaited below;
  // this only prevents an unhandled rejection if the loader exits before that.
  embedPromise.catch(() => {});

  // Fast path: active store exists -> return from DB immediately
  // Four conditions force a Shopify refresh (there is no "Gate D"; the four
  // gates are labelled A, B, C and the unlabelled 10-minute staleness check).
  const currentEndpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";
  const needsShopifyRefresh =
    !hasActiveStore || // Gate A: no Store row, or Gate B: isActive=false
    (store?.lastSyncedAt &&
      Date.now() - store.lastSyncedAt.getTime() > 10 * 60 * 1000) || // Stale > 10 min
    request.url.includes("?refresh=1") || // Explicit refresh
    // NEW: Gate C - if endpoint URL changed (tunnel restart), must update metaobject
    // `currentEndpoint` is "" when SHOPIFY_APP_URL is unset; comparing against
    // it would make Gate C permanently true and the fast path unreachable.
    (currentEndpoint && sc?.cachedAppEndpoint && sc.cachedAppEndpoint !== currentEndpoint);

let shopResult = { shopData: null, isNewStore: false };
  let shopifyConfig = null;
  let embedCheck = null;
  // true / false once confirmed, null = not determined yet (see below).
  let passwordProtected = null;
  let isNewStore = false;

  if (needsShopifyRefresh) {
    // Slow path: run Shopify calls in parallel (only when needed)
    const [shopRes, shopifyCfg, embedChk] = await Promise.all([
      (async () => {
        try {
          const shopData = await withShopifyTimeout(
            fetchShopDetailsFromShopify(admin),
            "ShopDetails",
          );
          shopData.currentScope = session.scope || undefined;
          const existingStore = await prisma.store.findUnique({
            where: { shopDomain: shopData.shopDomain },
            select: { id: true },
          });
          await upsertStore(shopData);
          return { shopData, isNewStore: !existingStore };
        } catch (err) {
          rethrowAuthRedirect(err);
          console.error(
            "[Dashboard] Failed to sync store details:",
            err instanceof Error ? err.message : err,
          );
          return { shopData: null, isNewStore: false };
        }
      })(),
      (async () => {
        try {
          const { config } = await withShopifyTimeout(
            ensureConfig(admin),
            "ensureConfig",
          );
          // Gate C: only write appEndpoint if URL differs
          if (!endpoint || config.appEndpoint === endpoint) {
            return config;
          }
          return await withShopifyTimeout(
            ensureAppEndpoint(admin, endpoint, config),
            "ensureAppEndpoint",
          );
        } catch (err) {
          rethrowAuthRedirect(err);
          console.error(
            "[Dashboard] Failed to load Shopify config:",
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      })(),
      embedPromise,
    ]);

    shopResult = shopRes;
    shopifyConfig = shopifyCfg;
    embedCheck = embedChk;
    isNewStore = shopResult.isNewStore;

    // Deliberately NOT guarded by `store?.id` alone: `store` was read BEFORE
    // upsertStore() ran, so on a genuine first visit it is null and the cache
    // was never written, leaving Gate C permanently unsatisfied.
    // Cache the app endpoint in StoreConfig for the fast path (Gate C).
    if (isNewStore || store?.id) {
      try {
        await prisma.storeConfig.upsert({
          where: { storeId: store.id },
          create: {
            storeId: store.id,
            appEnabled: false,
            script1Enabled: false,
            script2Enabled: false,
            script3Enabled: false,
            debugMode: false,
            scriptTitles: [],
            cachedAppEndpoint: shopifyConfig?.appEndpoint || endpoint || null,
          },
          update: {
            cachedAppEndpoint: shopifyConfig?.appEndpoint || endpoint || null,
          },
        });
      } catch (err) {
        console.error("[Dashboard] Failed to cache app endpoint:", err instanceof Error ? err.message : err);
      }
    }

    // Sync config from Shopify to DB (non-blocking on fast path)
    if (shopifyConfig) {
      await safeSyncConfig(session.shop, shopifyConfig);
    }

    // Log "installed" activity only when creating the Store row (first visit)
    if (isNewStore && shopResult.shopData) {
      await safeLogActivity(
        session.shop,
        "installed",
        `App installed — ${shopResult.shopData.shopName}`,
        { source: "first_visit", shopDomain: session.shop },
      );
    }
  } else {
    // Fast path: use cached values from DB, but the embed is always re-checked.
    embedCheck = await embedPromise;
  }

  // Password protection is confirmed in the BACKGROUND (never awaited here, so
  // the dashboard is not slowed down): a redirect probe of the store's live URL
  // in Chromium plus Shopify's own setting. Until a definite answer is stored
  // this stays null and the Step 1 password box stays hidden; the client polls
  // /api/password-status and shows the box when protection is confirmed.
  passwordProtected = sc?.isPasswordProtected ?? null;
  if (passwordProtected === null || needsShopifyRefresh) {
    void refreshPasswordProtection(admin, session.shop);
  }

  const dbConfig = configFromDbRow(sc);

  // On fast path, Shopify config is null -> use DB config
  // On slow path with successful Shopify call, Shopify config wins
  const mergedConfig = shopifyConfig
    ? shopifyConfig
    : dbConfig
      ? { ...DEFAULT_CONFIG, ...dbConfig }
      : DEFAULT_CONFIG;

  // Fail closed: only a confirmed `true` counts as enabled. `false` (embed off)
  // and `null` (check errored / timed out) both switch the toggle OFF.
  const embedEnabled = embedCheck === true;
  const embedStatus =
    embedCheck === true ? "enabled" : embedCheck === false ? "disabled" : "unknown";
  const embedActivateUrl = getAppEmbedDeepLink(
    session.shop,
    undefined,
    undefined,
    selectedThemeId,
  );

  // The embed is definitely off but the app is still recorded as enabled.
  // Not done for `null` (unknown) — a transient failure must not rewrite state.
  let autoDisabled = false;
  if (embedCheck === false && (sc?.appEnabled || mergedConfig.appEnabled)) {
    autoDisabled = true;
    mergedConfig.appEnabled = false;
    await disableAppBecauseEmbedOff({ admin, session, store });
  }

  let auditStatus = emptyAuditStatus();
  let storefrontPassword = "";
  let customPlpUrl = "";
  let customPdpUrl = "";
  if (sc) {
    storefrontPassword = sc.storefrontPassword || "";
    customPlpUrl = sc.customPlpUrl || "";
    customPdpUrl = sc.customPdpUrl || "";
    const pageIndex = sc.auditPageIndex ?? 0;
    const totalPages = sc.auditTotalPages ?? 0;
    auditStatus = {
      running: sc.auditRunning,
      complete: sc.auditComplete,
      failed: sc.auditFailed,
      error: sc.auditError,
      pageIndex,
      totalPages,
      progress: totalPages > 0 ? Math.round((pageIndex / totalPages) * 100) : 0,
      pages: readAuditPages(sc.auditPages),
      pageStartedAt: sc.auditPageStartedAt
        ? sc.auditPageStartedAt.toISOString()
        : null,
      phase: sc.auditPhase ?? null,
      serverNow: Date.now(),
    };
  }

  let auditDeferArray = readStringArray(mergedConfig.auditDeferArray);
  let auditHideSelectors = readStringArray(mergedConfig.auditHideSelectors);
  let staticDeferDefaults = ["wpm","gtm"];
  let dbToggle = null;
  let dbPreserved = null;
  if (sc) {
    const dbDefer = readStringArray(sc.auditDeferArray);
    const dbHide = readStringArray(sc.auditHideSelectors);
    const dbStatic = readStringArray(sc.staticDeferDefaults);
    // The DB is authoritative for these two arrays once an audit has actually
    // run. Previously this fell back to the metaobject whenever the DB array
    // was empty, which meant an audit that legitimately produced `[]` (e.g.
    // everything fold-protected, or a cleared run) was masked by a stale
    // metaobject value — the dashboard showed data the storefront script did
    // not have. `auditHasRun` keeps merchant-typed arrays working: a value
    // entered via `intent: "save-audit-defer"` only exists in the metaobject,
    // and that path is reachable before any audit has run.
    const auditHasRun = Boolean(sc.lastAuditAt);
    if (auditHasRun || dbDefer.length) auditDeferArray = dbDefer;
    if (auditHasRun || dbHide.length) auditHideSelectors = dbHide;
    staticDeferDefaults = dbStatic.length > 0 ? dbStatic : staticDeferDefaults;
    dbToggle = {
      auditDeferArrayEnabled: sc.auditDeferArrayEnabled ?? true,
      auditHideSelectorsEnabled: sc.auditHideSelectorsEnabled ?? true,
      staticDeferDefaultsEnabled: sc.staticDeferDefaultsEnabled ?? true,
      firstUserDelayScriptsEnabled: sc.firstUserDelayScriptsEnabled ?? true,  // NEW
    };
    dbPreserved = {
      auditDeferArrayPreserved: readStringArray(sc.auditDeferArrayPreserved),
      auditHideSelectorsPreserved: readStringArray(sc.auditHideSelectorsPreserved),
      staticDeferDefaultsPreserved: readStringArray(
        sc.staticDeferDefaultsPreserved,
      ),
      firstUserDelayScriptsPreserved: readStringArray(sc.firstUserDelayScriptsPreserved),
    };
  }

  const finalConfig = {
    ...mergedConfig,
    auditDeferArray,
    auditHideSelectors,
    staticDeferDefaults,
    auditDeferArrayEnabled: dbToggle?.auditDeferArrayEnabled ?? true,
    auditHideSelectorsEnabled: dbToggle?.auditHideSelectorsEnabled ?? true,
    staticDeferDefaultsEnabled: dbToggle?.staticDeferDefaultsEnabled ?? true,
    auditDeferArrayPreserved: dbPreserved?.auditDeferArrayPreserved ?? [],
    auditHideSelectorsPreserved: dbPreserved?.auditHideSelectorsPreserved ?? [],
    staticDeferDefaultsPreserved:
      dbPreserved?.staticDeferDefaultsPreserved ?? [],
    storefrontPassword,
    customPlpUrl,
    customPdpUrl,

    // NEW
      // readStringArray always returns an array and [] is truthy, so the old
      // `|| ["wpm","gtm"]` could never fall back. Check the length
      // explicitly so a genuinely-absent column gets the schema default.
      firstUserDelayScripts: (() => {
        const v = readStringArray(sc?.firstUserDelayScripts);
        return v.length ? v : ["wpm", "gtm"];
      })(),
    firstUserDelayScriptsEnabled: sc?.firstUserDelayScriptsEnabled ?? true,
      firstUserDelayScriptsPreserved: (() => { const v = readStringArray(sc?.firstUserDelayScriptsPreserved); return v.length ? v : []; })(), // readStringArray always returns an
      // array and [] is truthy, so `|| []` could never fall back.
      // Check the length explicitly to get the schema default.
    firstUserDelayMs: sc?.firstUserDelayMs ?? 12000,
    everyTimeDelayMs: sc?.everyTimeDelayMs ?? 6000,
  };

  console.log(
    `[Dashboard] loader ${Date.now() - loaderStarted}ms shopifyConfig=${Boolean(
      shopifyConfig,
    )} embed=${embedStatus} autoDisabled=${autoDisabled} fastPath=${!needsShopifyRefresh} pwProtected=${passwordProtected} endpointMatch=${sc?.cachedAppEndpoint === endpoint}`,
  );

  return {
    config: finalConfig,
    auditStatus,
    embedEnabled,
    embedStatus,
    embedActivateUrl,
    selectedThemeId,
    passwordProtected,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-app") {
    const appEnabled = formData.get("appEnabled") === "true";

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

    // No `auditRunning` here: enabling no longer implies an audit. The Step 1
    // "Run audit" button drives it, so the client must not enter the polling
    // state on its own.
    return { ok: true, config };
  }

  // Explicit, merchant-triggered audit. This is the ONLY way a run starts, so
  // it carries every guard the old automatic path relied on the toggle for:
  // the app must be ON, and the theme app embed must be confirmed installed
  // (the audit scans the storefront, which only carries the gate when the
  // embed is on).
  if (intent === "start-audit") {
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

    // One run at a time: `startAuditForStore` would spawn a second concurrent
    // Chromium run, and only the newer generation would be allowed to write.
    if (sc?.auditRunning) {
      return { ok: false, error: "already_running" };
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
      const { started } = await startAuditForStore(admin, session.shop);
      if (!started) return { ok: false, error: "Store record not found." };
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

  if (intent === "select-theme") {
    const themeId = String(formData.get("themeId") || "");

    let theme;
    try {
      const themes = await withShopifyTimeout(listThemes(admin), "listThemes");
      // Also enforces the selectable roles (no development/archived themes).
      theme = themes.find((t) => t.id === themeId);
    } catch (err) {
      rethrowAuthRedirect(err);
      return { ok: false, error: "Couldn't load themes. Please try again." };
    }
    if (!theme) return { ok: false, error: "Theme not found." };

    const store = await prisma.store.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    });
    if (!store) return { ok: false, error: "Store record not found." };

    const saved = await prisma.storeConfig.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        appEnabled: false,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: [],
        selectedThemeId: theme.id,
      },
      update: { selectedThemeId: theme.id },
    });

    // Switching themes while the app is ON: if the new theme does not have the
    // embed, the app can no longer work — turn it OFF (fail closed). An
    // unknown result is left to the loader, which shows OFF without persisting.
    const embed = await isAppEmbedEnabled(admin, undefined, theme.id);
    if (embed === false && saved.appEnabled) {
      await disableAppBecauseEmbedOff({ admin, session, store });
    }

    await safeLogActivity(
      session.shop,
      "config_changed",
      `Extension theme set to ${theme.name}`,
      { changedFields: ["selectedThemeId"], themeId: theme.id },
    );

    return {
      ok: true,
      selectedThemeId: theme.id,
      embedStatus:
        embed === true ? "enabled" : embed === false ? "disabled" : "unknown",
      embedActivateUrl: getAppEmbedDeepLink(
        session.shop,
        undefined,
        undefined,
        theme.id,
      ),
    };
  }

  if (intent === "toggle-script") {
    const scriptIndex = Number(formData.get("scriptIndex"));
    const enabled = formData.get("enabled") === "true";
    const key = ["script1Enabled", "script2Enabled", "script3Enabled"][
      scriptIndex
    ];
    if (!key) return { ok: false };
    const config = await safeUpdateConfig(admin, { [key]: enabled });

    await safeSyncConfig(session.shop, config);
    await safeLogActivity(
      session.shop,
      "config_changed",
      `Script ${scriptIndex + 1} ${enabled ? "enabled" : "disabled"}`,
      { changedFields: [key] },
    );

    return { ok: true, config };
  }

  if (intent === "toggle-audit-field") {
    const field = formData.get("field");
    const enabled = formData.get("enabled") === "true";
    const allowed = [
      "auditDeferArray",
      "auditHideSelectors",
      "staticDeferDefaults",
      "firstUserDelayScripts",
    ];
    if (typeof field !== "string" || !allowed.includes(field)) {
      return { ok: false, error: "Invalid field." };
    }

    const result = await updateAuditFieldToggle(session.shop, field, enabled);
    if (!result) {
      return { ok: false, error: "Store record not found." };
    }

    await safeLogActivity(
      session.shop,
      "config_changed",
      `${field} ${enabled ? "enabled" : "disabled"}`,
      { changedFields: [field] },
    );

    return { ok: true, field, enabled };
  }

  
  
  
  // DB-only step-3 writer for the audit/static arrays. Each provided field
  // must parse as a JSON array of strings; otherwise nothing is written.
  if (intent === "save-audit-arrays") {
    const parseJsonArray = (raw) => {
      try {
        const v = JSON.parse(raw || "[]");
        if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
          return v;
        }
        return null;
      } catch {
        return null;
      }
    };

    // If a field's toggle is OFF, force the stored value to [] regardless of
    // what was submitted (the real data stays in the preserved column).
    const prisma = (await import("../db.server")).default;
    const storeRow = await prisma.store.findUnique({
      where: { shopDomain: session.shop },
      select: {
        id: true,
        configs: {
          select: {
            auditDeferArrayEnabled: true,
            auditHideSelectorsEnabled: true,
            staticDeferDefaultsEnabled: true,
              // Without this, `sc.firstUserDelayScriptsEnabled` is always
              // undefined and the toggle-OFF -> [] coercion below can never
              // apply to firstUserDelayScripts (the ?? true fallback wins).
              firstUserDelayScriptsEnabled: true,
          },
        },
      },
    });
    const sc = storeRow?.configs?.[0];
    const toggleState = {
      auditDeferArray: sc?.auditDeferArrayEnabled ?? true,
      auditHideSelectors: sc?.auditHideSelectorsEnabled ?? true,
      staticDeferDefaults: sc?.staticDeferDefaultsEnabled ?? true,
      firstUserDelayScripts: sc?.firstUserDelayScriptsEnabled ?? true,
    };

    const patch = {};
    const fields = [
      ["auditDeferArray", formData.get("auditDeferArray")],
      ["auditHideSelectors", formData.get("auditHideSelectors")],
      ["staticDeferDefaults", formData.get("staticDeferDefaults")],
      ["firstUserDelayScripts", formData.get("firstUserDelayScripts")],
    ];
    for (const [key, raw] of fields) {
      if (formData.has(key)) {
        const value = (toggleState[key] ?? true)
          ? parseJsonArray(raw)
          : [];
        if (value === null) {
          return {
            ok: false,
            error: "Each field must be a valid JSON array of strings.",
          };
        }
        patch[key] = value;
      }
    }

    // NEW: Handle delay integer fields (stored in milliseconds)
    const firstUserDelayMs = formData.get("firstUserDelayMs");
    const everyTimeDelayMs = formData.get("everyTimeDelayMs");

    if (firstUserDelayMs !== null && firstUserDelayMs !== "") {
      const ms = parseInt(firstUserDelayMs, 10);
      if (!isNaN(ms) && ms >= 0) {
        patch.firstUserDelayMs = ms;
      }
    }

    if (everyTimeDelayMs !== null && everyTimeDelayMs !== "") {
      const ms = parseInt(everyTimeDelayMs, 10);
      if (!isNaN(ms) && ms >= 0) {
        patch.everyTimeDelayMs = ms;
      }
    }

    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "No fields to save." };
    }

    try {
      const result = await updateAuditArrays(session.shop, patch);
      if (!result) {
        return { ok: false, error: "Store record not found." };
      }
      return { ok: true, ...patch };
    } catch (err) {
      console.error(
        "[Dashboard] Failed to save audit arrays:",
        err instanceof Error ? err.message : err,
      );
      return {
        ok: false,
        error: "Failed to save. " + (err instanceof Error ? err.message : ""),
      };
    }
  }

  if (intent === "save-storefront-password") {
    const storefrontPassword = (formData.get("storefrontPassword") || "").trim();
    const prisma = (await import("../db.server")).default;
    const store = await prisma.store.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    });
    if (!store) return { ok: false, error: "Store record not found." };
    const saved = await prisma.storeConfig.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        appEnabled: false,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: [],
        storefrontPassword: storefrontPassword || null,
      },
      update: { storefrontPassword: storefrontPassword || null },
    });

    const passwordAuditError =
      saved.auditError === "PASSWORD_REQUIRED" ||
      saved.auditError === "PASSWORD_INCORRECT" ||
      (saved.auditFailed && /password/i.test(String(saved.auditError || "")));
    if (
      storefrontPassword &&
      saved.appEnabled &&
      (saved.auditRunning || passwordAuditError)
    ) {
      try {
        const { started } = await startAuditForStore(admin, session.shop);
        return { ok: true, storefrontPassword, auditRestarted: started };
      } catch (err) {
        console.warn(
          "[Dashboard] Failed to restart audit after password save:",
          err instanceof Error ? err.message : err,
        );
      }
    }
    return { ok: true, storefrontPassword };
  }

  if (intent === "save-custom-page-urls") {
    // Must be pages on this store; share-link params (_bt, key, preview_theme_id…)
    // are stripped. Nothing is saved unless both fields are valid.
    const plp = normalizeCustomUrl(formData.get("customPlpUrl"), session.shop, "plp");
    const pdp = normalizeCustomUrl(formData.get("customPdpUrl"), session.shop, "pdp");
    if (!plp.ok || !pdp.ok) {
      return {
        ok: false,
        plpError: plp.ok ? "" : plp.error,
        pdpError: pdp.ok ? "" : pdp.error,
      };
    }
    const customPlpUrl = plp.url || "";
    const customPdpUrl = pdp.url || "";
    const prisma = (await import("../db.server")).default;
    const store = await prisma.store.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true },
    });
    if (!store) return { ok: false, error: "Store record not found." };
    await prisma.storeConfig.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        appEnabled: false,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: [],
        customPlpUrl: customPlpUrl || null,
        customPdpUrl: customPdpUrl || null,
      },
      update: {
        customPlpUrl: customPlpUrl || null,
        customPdpUrl: customPdpUrl || null,
      },
    });
    return {
      ok: true,
      customPlpUrl,
      customPdpUrl,
      plpWarning: plp.warning || "",
      pdpWarning: pdp.warning || "",
    };
  }

  return { ok: false };
};

export default function Dashboard() {
  const {
    config,
    auditStatus: initialAuditStatus,
    embedEnabled = false,
    embedStatus = "unknown",
    embedActivateUrl = "",
    selectedThemeId = null,
    passwordProtected: loaderPasswordProtected = null,
  } = useLoaderData();
  const revalidator = useRevalidator();
  const [currentStep, setCurrentStep] = useState(1);
  const [auditStatus, setAuditStatus] = useState(initialAuditStatus);
  const completingRef = useRef(false);
  const [expectingAudit, setExpectingAudit] = useState(
    () => initialAuditStatus?.running === true,
  );

  // Password protection: null until the background check has a definite answer
  // (the Step 1 password box stays hidden until then); polls for it.
  const passwordProtected = usePasswordStatus(loaderPasswordProtected);

  const handleAuditRestarted = useCallback(() => {
    completingRef.current = false;
    setExpectingAudit(true);
    setCurrentStep(1);
    setAuditStatus((s) => ({
      ...s,
      running: true,
      failed: false,
      complete: false,
      error: null,
      pageIndex: 0,
      totalPages: 0,
      progress: 0,
      pages: [],
      pageStartedAt: null,
      phase: "discovering",
    }));
  }, []);

  // Merge the live "toggle-app" fetcher result in so the app gate unlocks
  // immediately when the Step 1 toggle is turned on (the loader data alone
  // doesn't refresh after a useFetcher submit).
  // Matched ONLY by intent, never by response shape: `useFetchers()` also
  // returns fetchers owned by the Step components, so keying on a response
  // field would let a `start-audit` response be mistaken for a toggle result
  // and drive `appEnabled`.
  const toggleFetcher = useFetchers().find(
    (f) => f.formData?.get("intent") === "toggle-app",
  );
  const auditFetcher = useFetchers().find(
    (f) => f.formData?.get("intent") === "start-audit",
  );
  const extensionBlocked =
    toggleFetcher?.data?.error === "extension_required";
  // Turning ON waits for the action. Optimistic formData would treat a
  // missing embed as enabled and unlock Step 2 from a leftover auditComplete.
  // Turning OFF is optimistic so the spinner hides immediately.
  const rawAppEnabled =
    toggleFetcher?.data?.config?.appEnabled ??
    (toggleFetcher?.formData?.get("appEnabled") === "false"
      ? false
      : config.appEnabled);
  const appEnabled = !extensionBlocked && embedEnabled ? rawAppEnabled : false;

  // Fresh config that reflects the in-flight Step 1 toggle so Step 2 shows
  // scripts ON as soon as the app is enabled, before any reload.
  const liveConfig = toggleFetcher?.data?.config
    ? { ...config, ...toggleFetcher.data.config, appEnabled }
    : { ...config, appEnabled };

  // The app must be enabled in Step 1 AND the hidden audit must have
  // completed before Step 2 (Scripts + Titles) unlocks. Until then the wizard
  // stays locked on Step 1. Step 2 auto-opens when the poll reports complete.
  const maxStep =
    appEnabled && !extensionBlocked && auditStatus?.complete ? 2 : 1;

  // Poll the hidden backend audit only while the main toggle is ON.
  // Toggle OFF must not start or keep showing an audit in progress.
  const auditInProgress =
    appEnabled && (expectingAudit || auditStatus?.running === true);

  // The audit is started explicitly from Step 1, never as a side effect of the
  // toggle. A successful `start-audit` response is what puts the dashboard into
  // the polling state. Keyed on the action's confirmed response, never on
  // in-flight formData: an optimistic start would skip the extension check.
  const enablingAudit =
    !extensionBlocked && auditFetcher?.data?.auditStarted === true;

  // Re-check embed status when the tab regains focus, in both directions:
  // merchant returns from the theme editor after enabling it (embedEnabled
  // false -> true), or disables/removes it in another tab while this
  // dashboard sits open with the app ON (Plan 1, item 6 — previously left
  // undone; the extra Admin call per focus is the same cost already paid
  // below for the embedEnabled=false case).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void revalidator.revalidate();
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revalidator]);

  useEffect(() => {
    if (appEnabled && initialAuditStatus?.running) setExpectingAudit(true);
  }, [appEnabled, initialAuditStatus?.running]);

  // When the Step-1 toggle is flipped ON, the action's background audit has
  // started in the DB but the loader's auditStatus never heard about it. Force
  // the client into a "running" state immediately (even before the action
  // resolves, via the optimistic formData) so the Step-1 loader + countdown
  // show right away and the polling effect below starts.
  useEffect(() => {
    if (enablingAudit && appEnabled) {
      completingRef.current = false;
      setExpectingAudit(true);
      setCurrentStep(1);
      setAuditStatus((s) => ({
        ...s,
        running: true,
        failed: false,
        complete: false,
        pageIndex: 0,
        totalPages: 0,
        progress: 0,
        pages: [],
        pageStartedAt: null,
        phase: "discovering",
      }));
    }
  }, [enablingAudit, appEnabled]);

  // Toggle OFF, missing embed, or extension_required: stay on Step 1.
  // Never keep a leftover auditComplete jump from sending the merchant to Step 2.
  useEffect(() => {
    if (appEnabled && !extensionBlocked) return;
    setExpectingAudit(false);
    setCurrentStep(1);
    setAuditStatus((s) =>
      s?.running || s?.failed
        ? { ...s, running: false, failed: false }
        : s,
    );
  }, [appEnabled, extensionBlocked]);

  useEffect(() => {
    if (!auditInProgress) return;
    if (auditStatus?.complete || auditStatus?.failed) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/audit/status${window.location.search}`);
        if (!res.ok || cancelled) return;
        const data = await res.json();
        setAuditStatus((prev) => {
          if (!data.running && !data.complete && !data.failed) {
            return { ...prev, ...data, running: true };
          }
          return data;
        });
        if (data.complete) {
          setExpectingAudit(false);
          if (!completingRef.current && appEnabled && !extensionBlocked) {
            completingRef.current = true;
            void revalidator.revalidate();
            setCurrentStep((step) => (step === 1 ? 2 : step));
          }
        } else if (data.failed) {
          setExpectingAudit(false);
        }
      } catch {
        // transient poll failure — keep showing the loader and keep polling
      }
    };

    poll();
    const timer = setInterval(poll, 1000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [
    auditInProgress,
    auditStatus?.complete,
    auditStatus?.failed,
    appEnabled,
    extensionBlocked,
    revalidator,
  ]);

  const goToStep = (step) => {
    console.log(`Dashboard: goToStep(${step}) called (maxStep=${maxStep})`);
    // Clamp to the highest allowed step — cannot skip past the app gate.
    setCurrentStep(Math.min(Math.max(step, 1), maxStep));
  };

  return (
    <s-page heading="Performance Improvement">
      <WizardProgress currentStep={currentStep} maxStep={maxStep} onStepClick={goToStep} />

      {currentStep === 1 && (
        <Step1Activate
          config={config}
          auditStatus={auditStatus}
          embedEnabled={embedEnabled}
          embedStatus={embedStatus}
          embedActivateUrl={embedActivateUrl}
          selectedThemeId={selectedThemeId}
          passwordProtected={passwordProtected}
          onAuditRestarted={handleAuditRestarted}
        />
      )}
      {currentStep === 2 && <Step2Configure config={liveConfig} />}

      <WizardNavigation
        currentStep={currentStep}
        maxStep={maxStep}
        onChange={goToStep}
      />

      <FooterBranding />
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
