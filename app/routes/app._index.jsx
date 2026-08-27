import { useState } from "react";
import { useLoaderData, useFetchers, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureConfig, updateConfig } from "../lib/metaobjects";
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
};

async function safeUpdateConfig(admin, input) {
  try {
    return await updateConfig(admin, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No metaobject definition exists")) {
      console.warn(
        "[Dashboard] Metaobject definition not deployed. " +
        "Run shopify app config push. Returning defaults."
      );
      return { ...DEFAULT_CONFIG, ...input };
    }
    throw err;
  }
}

export const loader = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const { config } = await ensureConfig(admin);
  return { config };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
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
    return { ok: true, config };
  }

  if (intent === "toggle-script") {
    const scriptIndex = Number(formData.get("scriptIndex"));
    const enabled = formData.get("enabled") === "true";
    const key = ["script1Enabled", "script2Enabled", "script3Enabled"][scriptIndex];
    if (!key) return { ok: false };
    const config = await safeUpdateConfig(admin, { [key]: enabled });
    return { ok: true, config };
  }

  if (intent === "save-titles") {
    const scriptTitles = JSON.parse(formData.get("scriptTitles") || "[]");
    const config = await safeUpdateConfig(admin, { scriptTitles });
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
