import { useState, useEffect, useRef } from "react";
import { useLoaderData, useFetchers, useRouteError, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
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
  saveAuditReport,
  readStringArray,
  updateAuditArrays,
  updateAuditFieldToggle,
} from "../lib/store-sync.server";
import {
  discoverPages,
  runHiddenAudit,
  getActiveThemeId,
} from "../lib/audit.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
} from "../lib/theme-embed.server";
import { withShopifyTimeout } from "../lib/shopify-timeout.server";
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
  staticDeferDefaults: ["wpm", "gtm", "clarity"],
  auditDeferArrayEnabled: true,
  auditHideSelectorsEnabled: true,
  staticDeferDefaultsEnabled: true,
  auditDeferArrayPreserved: [],
  auditHideSelectorsPreserved: [],
  staticDeferDefaultsPreserved: [],
  auditComplete: false,
  appEndpoint: "",
  storefrontPassword: "",
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

// Triggers the hidden backend headless-browser audit in the background.
// Non-blocking: sets auditRunning in the DB and returns immediately so the
// dashboard can poll /api/audit/status. The audit is invisible to the merchant.
async function startHiddenAudit(admin, shopDomain) {
  const prisma = (await import("../db.server")).default;
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });
  if (!store) {
    console.warn(`[Audit] SKIPPED — no Store row for ${shopDomain}.`);
    return;
  }
  await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      appEnabled: true,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      auditRunning: true,
      auditFailed: false,
      auditError: null,
    },
    update: {
      auditRunning: true,
      auditFailed: false,
      auditError: null,
      auditComplete: false,
      auditPageIndex: 0,
      auditTotalPages: 0,
    },
  });
  console.log(`[Audit] STARTED for ${shopDomain} (auditRunning=true)`);
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    try {
      // If the store owner saved a storefront password (Step 1, for
      // password-protected/dev stores), fetch the active theme id and pass
      // both through so the audit hits the password-bypass URLs instead of
      // Shopify's password page.
      const storeConfig = await prisma.storeConfig.findUnique({
        where: { storeId: store.id },
      });
      const password = storeConfig?.storefrontPassword || "";
      const themeId = password ? await getActiveThemeId(admin) : undefined;
      const customUrls = {
        plp: storeConfig?.customPlpUrl || undefined,
        pdp: storeConfig?.customPdpUrl || undefined,
      };

      const pages = await discoverPages(
        admin,
        shopDomain,
        password || undefined,
        themeId,
        customUrls,
      );
      console.log(`[Audit] Pages discovered for ${shopDomain}:`, JSON.stringify(pages));
      const report = await runHiddenAudit({
        pages,
        password: password || undefined,
        onProgress: async ({ pageIndex, total }) => {
          await prisma.storeConfig.update({
            where: { storeId: store.id },
            data: { auditPageIndex: pageIndex, auditTotalPages: total },
          });
        },
      });
      await saveAuditReport(shopDomain, report);
      await prisma.storeConfig.update({
        where: { storeId: store.id },
        data: {
          auditRunning: false,
          auditComplete: true,
          auditFailed: false,
          auditError: null,
          auditPageIndex: 0,
          auditTotalPages: pages ? Object.values(pages).filter(Boolean).length : 0,
        },
      });
      console.log(
        `[Audit] COMPLETED for ${shopDomain}: defer=${JSON.stringify(report.deferArray)} hide=${JSON.stringify(report.hideSelectors)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Audit] FAILED for " + shopDomain + ":", msg);
      await prisma.storeConfig.update({
        where: { storeId: store.id },
        data: {
          auditRunning: false,
          auditFailed: true,
          auditError: msg,
          auditComplete: false,
        },
      });
    }
  })();
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
  const { admin, session } = await authenticate.admin(request);
  // eslint-disable-next-line no-undef
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const endpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";

  const [shopResult, shopifyConfig, embedCheck, storeRow] = await Promise.all([
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
        if (!endpoint || config.appEndpoint === endpoint) {
          return config;
        }
        return await withShopifyTimeout(
          ensureAppEndpoint(admin, endpoint, config),
          "ensureAppEndpoint",
        );
      } catch (err) {
        console.error(
          "[Dashboard] Failed to load Shopify config:",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    })(),
    (async () => {
      try {
        return await withShopifyTimeout(
          isAppEmbedEnabled(admin),
          "isAppEmbedEnabled",
        );
      } catch (err) {
        console.error(
          "[Dashboard] Failed to read embed status:",
          err instanceof Error ? err.message : err,
        );
        return null;
      }
    })(),
    prisma.store.findUnique({
      where: { shopDomain: session.shop },
      select: { configs: { select: STORE_CONFIG_SELECT } },
    }),
  ]);

  const sc = storeRow?.configs?.[0];
  const dbConfig = configFromDbRow(sc);

  // Shopify metaobject is the live source for flags/titles when the call
  // succeeds. On timeout/error, use last-known StoreConfig — never invent
  // "app on" or fake audit arrays.
  const mergedConfig = shopifyConfig
    ? shopifyConfig
    : dbConfig
      ? { ...DEFAULT_CONFIG, ...dbConfig }
      : DEFAULT_CONFIG;

  if (shopifyConfig) {
    await safeSyncConfig(session.shop, mergedConfig);
  }

  const embedEnabled = embedCheck !== false;
  const embedActivateUrl = getAppEmbedDeepLink(session.shop);

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
    };
  }

  if (shopResult.isNewStore && shopResult.shopData) {
    await safeLogActivity(
      session.shop,
      "installed",
      `App installed — ${shopResult.shopData.shopName}`,
      { source: "first_visit", shopDomain: session.shop },
    );
  }

  let auditDeferArray = readStringArray(mergedConfig.auditDeferArray);
  let auditHideSelectors = readStringArray(mergedConfig.auditHideSelectors);
  let staticDeferDefaults = ["wpm", "gtm", "clarity"];
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
    };
    dbPreserved = {
      auditDeferArrayPreserved: readStringArray(sc.auditDeferArrayPreserved),
      auditHideSelectorsPreserved: readStringArray(sc.auditHideSelectorsPreserved),
      staticDeferDefaultsPreserved: readStringArray(
        sc.staticDeferDefaultsPreserved,
      ),
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
  };

  console.log(
    `[Dashboard] loader ${Date.now() - loaderStarted}ms shopifyConfig=${Boolean(shopifyConfig)} embed=${String(embedCheck)}`,
  );

  return {
    config: finalConfig,
    auditStatus,
    embedEnabled,
    embedActivateUrl,
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-app") {
    const appEnabled = formData.get("appEnabled") === "true";

    if (appEnabled) {
      const embedCheck = await isAppEmbedEnabled(admin);
      if (embedCheck === false) {
        return {
          ok: false,
          error: "extension_required",
          embedEnabled: false,
          embedActivateUrl: getAppEmbedDeepLink(session.shop),
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
        await startHiddenAudit(admin, session.shop);
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
    const allowed = ["auditDeferArray", "auditHideSelectors", "staticDeferDefaults"];
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
    };

    const patch = {};
    const fields = [
      ["auditDeferArray", formData.get("auditDeferArray")],
      ["auditHideSelectors", formData.get("auditHideSelectors")],
      ["staticDeferDefaults", formData.get("staticDeferDefaults")],
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
    const customPlpUrl = (formData.get("customPlpUrl") || "").trim();
    const customPdpUrl = (formData.get("customPdpUrl") || "").trim();
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
    return { ok: true, customPlpUrl, customPdpUrl };
  }

  return { ok: false };
};

export default function Dashboard() {
  const {
    config,
    auditStatus: initialAuditStatus,
    embedEnabled = false,
    embedActivateUrl = "",
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
  const rawAppEnabled =
    toggleFetcher?.data?.config?.appEnabled ??
    (toggleFetcher?.formData
      ? toggleFetcher.formData.get("appEnabled") === "true"
      : config.appEnabled);
  const appEnabled = embedEnabled ? rawAppEnabled : false;

  // Fresh config that reflects the in-flight Step 1 toggle so Step 2 shows
  // scripts ON as soon as the app is enabled, before any reload.
  const liveConfig = toggleFetcher?.data?.config
    ? { ...config, ...toggleFetcher.data.config, appEnabled }
    : { ...config, appEnabled };

  // The app must be enabled in Step 1 AND the hidden audit must have
  // completed before Step 2 (Scripts + Titles) unlocks. Until then the wizard
  // stays locked on Step 1. Step 2 auto-opens when the poll reports complete.
  const maxStep = appEnabled && auditStatus?.complete ? 2 : 1;

  // Poll the hidden backend audit status while it is running. When it
  // completes, auto-open Step 2. The audit results are stored in the DB only —
  // they are not wired into the Step 2/3 UI.
  const auditInProgress =
    expectingAudit || auditStatus?.running === true;

  // A toggle-ON is either confirmed by the action response or optimistic via
  // the fetcher's submitted formData (before the action resolves).
  const toggleDataOn = toggleFetcher?.data?.auditRunning === true;
  const toggleFormOn =
    toggleFetcher?.formData?.get("appEnabled") === "true";
  const enablingAudit = toggleDataOn || toggleFormOn;

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
    if (initialAuditStatus?.running) setExpectingAudit(true);
  }, [initialAuditStatus?.running]);

  // When the Step-1 toggle is flipped ON, the action's background audit has
  // started in the DB but the loader's auditStatus never heard about it. Force
  // the client into a "running" state immediately (even before the action
  // resolves, via the optimistic formData) so the Step-1 loader + countdown
  // show right away and the polling effect below starts.
  useEffect(() => {
    if (enablingAudit) {
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
      }));
    }
  }, [enablingAudit]);

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
          if (!completingRef.current) {
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
    revalidator,
  ]);

  const goToStep = (step) => {
    console.log(`Dashboard: goToStep(${step}) called (maxStep=${maxStep})`);
    // Clamp to the highest allowed step — cannot skip past the app gate.
    setCurrentStep(Math.min(Math.max(step, 1), maxStep));
  };

  // "Done" on the final step simply returns to Step 1. Each step persists its
  // own values: Step 1/2 via toggles, Step 3 via its per-box Save buttons.
  const handleDone = () => {
    setCurrentStep(1);
  };

  return (
    <s-page heading="Performance Improvement">
      <WizardProgress currentStep={currentStep} maxStep={maxStep} onStepClick={goToStep} />

      {currentStep === 1 && (
        <Step1Activate
          config={config}
          auditStatus={auditStatus}
          embedEnabled={embedEnabled}
          embedActivateUrl={embedActivateUrl}
        />
      )}
      {currentStep === 2 && <Step2Configure config={liveConfig} />}

      <WizardNavigation
        currentStep={currentStep}
        maxStep={maxStep}
        onChange={goToStep}
        onDone={handleDone}
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
