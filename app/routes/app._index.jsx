import { useState } from "react";
import { useLoaderData, useFetchers, useRouteError } from "react-router";
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
} from "../lib/store-sync.server";
import WizardProgress from "../components/WizardProgress";
import Step1Activate from "../components/Step1Activate";
import Step2Configure from "../components/Step2Configure";
import Step3Titles from "../components/Step3Titles";
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
  auditComplete: false,
  appEndpoint: "",
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

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // --- Sync store details to database (on every visit; upsert is a no-op
  // update after the first) and detect whether this is a brand-new install.
  let shopData = null;
  let isNewStore = false;
  try {
    shopData = await fetchShopDetailsFromShopify(admin);
    shopData.currentScope = session.scope || undefined;

    const prisma = (await import("../db.server")).default;
    const existingStore = await prisma.store.findUnique({
      where: { shopDomain: shopData.shopDomain },
      select: { id: true },
    });
    isNewStore = !existingStore;

    await upsertStore(shopData);
  } catch (err) {
    console.error(
      "[Dashboard] Failed to sync store details:",
      err instanceof Error ? err.message : err,
    );
  }

  // ensureConfig creates the singleton if missing; ensureAppEndpoint syncs the
  // public /audit-submit URL from SHOPIFY_APP_URL so the storefront audit
  // script can POST results back (auto-sync, no manual editing).
  const { config } = await ensureConfig(admin);
  // eslint-disable-next-line no-undef
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const endpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";
  const configWithEndpoint = await ensureAppEndpoint(admin, endpoint);
  const mergedConfig = { ...config, ...configWithEndpoint };

  // --- Sync config to database on every dashboard load ---
  await safeSyncConfig(session.shop, mergedConfig);

  // --- Log "installed" event only the first time a store record is created ---
  if (isNewStore && shopData) {
    await safeLogActivity(
      session.shop,
      "installed",
      `App installed — ${shopData.shopName}`,
      { source: "first_visit", shopDomain: session.shop },
    );
  }

  return { config: mergedConfig };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-app") {
    const appEnabled = formData.get("appEnabled") === "true";
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
    if (!appEnabled) {
      // Clear audit_complete + audited arrays so the next OFF->ON cycle
      // triggers a fresh one-time audit (Implementation Plan 4, Phase 4.1).
      try {
        await resetAudit(admin);
      } catch (err) {
        console.warn(
          "[Dashboard] resetAudit failed:",
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

    return { ok: true, config };
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

  return { ok: false };
};

export default function Dashboard() {
  const { config } = useLoaderData();
  const [currentStep, setCurrentStep] = useState(1);

  // Merge the live "toggle-app" fetcher result in so the app gate unlocks
  // immediately when the Step 1 toggle is turned on (the loader data alone
  // doesn't refresh after a useFetcher submit).
  const toggleFetcher = useFetchers().find(
    (f) => f.formData?.get("intent") === "toggle-app",
  );
  const appEnabled =
    toggleFetcher?.data?.config?.appEnabled ??
    (toggleFetcher?.formData
      ? toggleFetcher.formData.get("appEnabled") === "true"
      : config.appEnabled);

  // Fresh config that reflects the in-flight Step 1 toggle so Step 2 shows
  // scripts ON as soon as the app is enabled, before any reload.
  const liveConfig = toggleFetcher?.data?.config
    ? { ...config, ...toggleFetcher.data.config, appEnabled }
    : { ...config, appEnabled };

  // Step 2 (Scripts) and Step 3 (Titles) are only reachable once the app
  // is enabled in Step 1. Anything else stays locked on Step 1.
  const maxStep = appEnabled ? 3 : 1;

  const goToStep = (step) => {
    // Clamp to the highest allowed step — cannot skip past the app gate.
    setCurrentStep(Math.min(Math.max(step, 1), maxStep));
  };

  return (
    <s-page heading="Performance Improvement">
      <WizardProgress
        currentStep={currentStep}
        maxStep={maxStep}
        onStepClick={goToStep}
      />

      {currentStep === 1 && <Step1Activate config={config} />}
      {currentStep === 2 && <Step2Configure config={liveConfig} />}
      {currentStep === 3 && <Step3Titles config={config} />}

      <WizardNavigation
        currentStep={currentStep}
        maxStep={maxStep}
        onChange={goToStep}
        onDone={() => setCurrentStep(1)}
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
