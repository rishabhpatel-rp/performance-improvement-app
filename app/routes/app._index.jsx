import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetchers, useRouteError, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// Request-scoped key for caching auth result (must match app.jsx)
const AUTH_CACHE_KEY = "__pagepulse_admin_auth__";
import {
  ensureConfig,
  ensureAppEndpoint,
  updateConfig,
  resetAudit,
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
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
  getSelectedThemeId,
  listThemes,
} from "../lib/theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "../lib/shopify-timeout.server";
import prisma from "../db.server";
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
  // Safety gates A-D determine when we must refresh from Shopify
  const currentEndpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";
  const needsShopifyRefresh =
    !hasActiveStore || // Gate A: no Store row, or Gate B: isActive=false
    (store?.lastSyncedAt &&
      Date.now() - store.lastSyncedAt.getTime() > 10 * 60 * 1000) || // Stale > 10 min
    request.url.includes("?refresh=1") || // Explicit refresh
    // NEW: Gate C - if endpoint URL changed (tunnel restart), must update metaobject
    (sc?.cachedAppEndpoint && sc.cachedAppEndpoint !== currentEndpoint);

let shopResult = { shopData: null, isNewStore: false };
  let shopifyConfig = null;
  let embedCheck = null;
  let passwordProtected = false;
  let isNewStore = false;

  if (needsShopifyRefresh) {
    // Slow path: run Shopify calls in parallel (only when needed)
    const [shopRes, shopifyCfg, embedChk, pwProtected] = await Promise.all([
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
      (async () => {
        try {
          const response = await withShopifyTimeout(
            admin.graphql(`
              query OnlineStorePasswordStatus {
                onlineStore {
                  passwordProtection {
                    enabled
                  }
                }
              }
            `),
            "passwordProtection",
          );
          const data = await response.json();
          return data.data?.onlineStore?.passwordProtection?.enabled ?? false;
        } catch (err) {
          rethrowAuthRedirect(err);
          return false;
        }
      })(),
    ]);

    shopResult = shopRes;
    shopifyConfig = shopifyCfg;
    embedCheck = embedChk;
    passwordProtected = pwProtected;
    isNewStore = shopResult.isNewStore;

    // NEW: Cache passwordProtected and appEndpoint in StoreConfig for fast path
    if (store?.id && (passwordProtected !== undefined || shopifyConfig?.appEndpoint)) {
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
            isPasswordProtected: passwordProtected ?? false,
            cachedAppEndpoint: shopifyConfig?.appEndpoint || endpoint || null,
          },
          update: {
            isPasswordProtected: passwordProtected ?? false,
            cachedAppEndpoint: shopifyConfig?.appEndpoint || endpoint || null,
          },
        });
      } catch (err) {
        console.error("[Dashboard] Failed to cache password/endpoint status:", err instanceof Error ? err.message : err);
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

    // NEW: Read cached passwordProtected from DB instead of assuming false
    passwordProtected = sc?.isPasswordProtected ?? false;
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
    if (dbDefer.length) auditDeferArray = dbDefer;
    if (dbHide.length) auditHideSelectors = dbHide;
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
    firstUserDelayScripts: readStringArray(sc?.firstUserDelayScripts) || ["wpm","gtm"],
    firstUserDelayScriptsEnabled: sc?.firstUserDelayScriptsEnabled ?? true,
    firstUserDelayScriptsPreserved: readStringArray(sc?.firstUserDelayScriptsPreserved) || [],
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
        const response = await withShopifyTimeout(
          admin.graphql(`#graphql
            query OnlineStorePasswordStatus {
              onlineStore {
                passwordProtection {
                  enabled
                }
              }
            }
          `),
          "passwordProtection",
        );
        const data = await response.json();
        const isPasswordProtected =
          data.data?.onlineStore?.passwordProtection?.enabled ?? false;

        if (isPasswordProtected) {
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
        // Fail-closed: if we can't confirm password status, don't enable.
        console.warn(
          "[Dashboard] toggle-app password check failed:",
          err instanceof Error ? err.message : err,
        );
        return {
          ok: false,
          error: "password_required",
          config: { appEnabled: false },
        };
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

    if (appEnabled) {
      // Fresh OFF->ON cycle clears the previous audit so the hidden backend
      // audit re-runs, then it is triggered in the background.
      try {
        await resetAudit(admin);
      } catch (err) {
        console.warn(
          "[Dashboard] resetAudit failed:",
          err instanceof Error ? err.message : err,
        );
      }
      try {
        await startAuditForStore(admin, session.shop, {
          enableOnCreate: true,
        });
      } catch (err) {
        console.warn(
          "[Dashboard] Failed to start hidden audit:",
          err instanceof Error ? err.message : err,
        );
      }
    } else {
      // Disabling clears audit_complete + audited arrays so the next OFF->ON
      // cycle triggers a fresh audit, and clears the DB audit status.
      try {
        await resetAudit(admin);
      } catch (err) {
        console.warn(
          "[Dashboard] resetAudit failed:",
          err instanceof Error ? err.message : err,
        );
      }
      try {
        const prisma = (await import("../db.server")).default;
        const store = await prisma.store.findUnique({
          where: { shopDomain: session.shop },
          select: { id: true },
        });
        if (store) {
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
            },
            update: {
              auditRunning: false,
              auditComplete: false,
              auditFailed: false,
              auditError: null,
              lastAuditAt: null,
              auditDeferArray: [],
              auditHideSelectors: [],
            },
          });
        }
      } catch (err) {
        console.warn(
          "[Dashboard] Failed to clear audit status:",
          err instanceof Error ? err.message : err,
        );
      }
    }

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

    // Propagate the audit running state to the client so the Step-1 spinner
    // can show and the dashboard can start polling immediately after the
    // toggle (see the useEffect below).
    return { ok: true, config, auditRunning: appEnabled };
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

  if (intent === "save-titles") {
    const scriptTitles = JSON.parse(formData.get("scriptTitles") || "[]");
    const config = await safeUpdateConfig(admin, { scriptTitles });

    await safeSyncConfig(session.shop, config);

    return { ok: true, config };
  }

  if (intent === "save-audit-defer") {
    const auditDeferArray = JSON.parse(formData.get("auditDeferArray") || "[]");
    const config = await safeUpdateConfig(admin, { auditDeferArray });

    await safeSyncConfig(session.shop, config);

    return { ok: true, config };
  }

  if (intent === "save-audit-hide") {
    const auditHideSelectors = JSON.parse(
      formData.get("auditHideSelectors") || "[]",
    );
    const config = await safeUpdateConfig(admin, { auditHideSelectors });

    await safeSyncConfig(session.shop, config);

    return { ok: true, config };
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
        storefrontPassword: storefrontPassword || null,
      },
      update: { storefrontPassword: storefrontPassword || null },
    });
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
    passwordProtected = false,
  } = useLoaderData();
  const revalidator = useRevalidator();
  const [currentStep, setCurrentStep] = useState(1);
  const [auditStatus, setAuditStatus] = useState(initialAuditStatus);
  const completingRef = useRef(false);
  const [expectingAudit, setExpectingAudit] = useState(
    () => initialAuditStatus?.running === true,
  );

  // Merge the live "toggle-app" fetcher result in so the app gate unlocks
  // immediately when the Step 1 toggle is turned on (the loader data alone
  // doesn't refresh after a useFetcher submit).
  const toggleFetcher = useFetchers().find(
    (f) =>
      f.formData?.get("intent") === "toggle-app" ||
      typeof f.data?.auditRunning === "boolean",
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

  // A toggle-ON is either confirmed by the action response or optimistic via
  // the fetcher's submitted formData (before the action resolves).
  // Only a successful toggle-ON starts the audit. Do not treat in-flight
  // formData as a start — that skipped the extension check and jumped to Step 2.
  const enablingAudit =
    !extensionBlocked && toggleFetcher?.data?.auditRunning === true;

  // Re-check embed status when the merchant returns from the theme editor.
  useEffect(() => {
    if (embedEnabled) return;
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
  }, [embedEnabled, revalidator]);

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
