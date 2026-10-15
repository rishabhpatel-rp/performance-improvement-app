import { updateConfig } from "./metaobjects";
import { syncConfigToDatabase, logActivity, readStringArray } from "./store-sync.server";
import prisma from "../db.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";
import { rebuildPerformanceScript } from "./performance-script.server";

/** Request-scoped key for caching auth (must match `app.jsx`). */
export const AUTH_CACHE_KEY = "__pagepulse_admin_auth__";

export const DEFAULT_CONFIG = {
  appEnabled: false,
  script1Enabled: false,
  script2Enabled: false,
  script3Enabled: false,
  scriptTitles: ["", "", ""],
  debugMode: false,
  auditDeferArray: [],
  auditHideSelectors: [],
  staticDeferDefaults: ["wpm", "gtm"],
  auditDeferArrayEnabled: true,
  auditHideSelectorsEnabled: true,
  staticDeferDefaultsEnabled: true,
  auditDeferArrayPreserved: [],
  auditHideSelectorsPreserved: [],
  staticDeferDefaultsPreserved: [],
  auditComplete: false,
  appEndpoint: "",
  storefrontPassword: "",
  firstUserDelayScripts: ["wpm", "gtm"],
  firstUserDelayScriptsEnabled: true,
  firstUserDelayScriptsPreserved: [],
  firstUserDelayMs: 12000,
  everyTimeDelayMs: 6000,
};

export async function safeUpdateConfig(admin, input) {
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

export async function safeSyncConfig(shop, config) {
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

export async function safeLogActivity(shop, eventType, description, metadata) {
  try {
    await logActivity(shop, eventType, description, metadata);
  } catch (err) {
    console.error(
      "[Dashboard] Failed to log activity:",
      err instanceof Error ? err.message : err,
    );
  }
}

export async function disableAppBecauseEmbedOff({ admin, session, store }) {
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

export const STORE_CONFIG_SELECT = {
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
  customPageUrls: true,
  auditDeferArray: true,
  auditHideSelectors: true,
  staticDeferDefaults: true,
  auditDeferArrayEnabled: true,
  auditHideSelectorsEnabled: true,
  staticDeferDefaultsEnabled: true,
  auditDeferArrayPreserved: true,
  auditHideSelectorsPreserved: true,
  staticDeferDefaultsPreserved: true,
  firstUserDelayScripts: true,
  firstUserDelayScriptsEnabled: true,
  firstUserDelayScriptsPreserved: true,
  firstUserDelayMs: true,
  everyTimeDelayMs: true,
  auditDeferGlobal: true,
  auditDeferHome: true,
  auditDeferCollection: true,
  auditDeferProduct: true,
  auditHideGlobal: true,
  auditHideHome: true,
  auditHideCollection: true,
  auditHideProduct: true,
  staticDeferDefaultsGlobal: true,
  staticDeferDefaultsHome: true,
  staticDeferDefaultsCollection: true,
  staticDeferDefaultsProduct: true,
  firstUserDelayScriptsGlobal: true,
  firstUserDelayScriptsHome: true,
  firstUserDelayScriptsCollection: true,
  firstUserDelayScriptsProduct: true,
  firstUserDelayMsGlobal: true,
  firstUserDelayMsHome: true,
  firstUserDelayMsCollection: true,
  firstUserDelayMsProduct: true,
  everyTimeDelayMsGlobal: true,
  everyTimeDelayMsHome: true,
  everyTimeDelayMsCollection: true,
  everyTimeDelayMsProduct: true,
  themeHeadInjectStatus: true,
  themeHeadInjectError: true,
  themeHeadInjectAttemptedAt: true,
  psiFieldVitals: true,
  psiLastFetchedAt: true,
  psiBackoffUntil: true,
  isPasswordProtected: true,
  cachedAppEndpoint: true,
  lastAuditAt: true,
  auditPhase: true,
  activeAuditJobId: true,
};

export function emptyAuditStatus() {
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

export function configFromDbRow(sc) {
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
