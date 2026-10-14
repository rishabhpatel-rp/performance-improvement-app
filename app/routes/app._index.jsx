import { useState, useEffect, useRef, useCallback } from "react";
import { useLoaderData, useFetchers, useRouteError, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { usePasswordStatus } from "../lib/use-password-status";
import WizardProgress from "../components/WizardProgress";
import Step1Activate from "../components/Step1Activate";
import Step2Configure from "../components/Step2Configure";
import Step3AuditResults from "../components/Step3AuditResults";
import WizardNavigation from "../components/WizardNavigation";
import FooterBranding from "../components/FooterBranding";

export { loader } from "../lib/dashboard-loader.server.js";
export { action } from "../lib/dashboard-actions.server.js";
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
  const lastFullRevalidateRef = useRef(0);
  const [embedLive, setEmbedLive] = useState(() => ({
    enabled: embedEnabled,
    status: embedStatus,
    url: embedActivateUrl,
  }));
  const [currentStep, setCurrentStep] = useState(1);
  const [auditStatus, setAuditStatus] = useState(initialAuditStatus);
  const completingRef = useRef(false);
  const [expectingAudit, setExpectingAudit] = useState(
    () => initialAuditStatus?.running === true,
  );

  // Password protection: null until the background check has a definite answer
  // (the Step 1 password box stays hidden until then); polls for it.
  const passwordProtected = usePasswordStatus(loaderPasswordProtected);

  const handleAuditStopped = useCallback(() => {
    completingRef.current = false;
    setExpectingAudit(false);
    setAuditStatus((s) => ({
      ...s,
      running: false,
      failed: false,
      complete: false,
      error: null,
      pageIndex: 0,
      totalPages: 0,
      progress: 0,
      pages: [],
      pageStartedAt: null,
      phase: null,
    }));
  }, []);

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
  const appEnabled =
    !extensionBlocked && embedLive.enabled ? rawAppEnabled : false;

  const auditCompleteEffective =
    Boolean(config.auditComplete) || Boolean(auditStatus?.complete);

  // Fresh config that reflects the in-flight Step 1 toggle so Step 2 shows
  // scripts ON as soon as the app is enabled, before any reload.
  const liveConfig = {
    ...(toggleFetcher?.data?.config
      ? { ...config, ...toggleFetcher.data.config }
      : config),
    appEnabled,
    auditComplete: auditCompleteEffective,
  };

  // The app must be enabled in Step 1 AND the hidden audit must have
  // completed before Step 2 (Scripts + Titles) unlocks. Until then the wizard
  // stays locked on Step 1. Step 2 auto-opens when the poll reports complete.
  const maxStep =
    appEnabled && !extensionBlocked && auditStatus?.complete ? 3 : 1;

  // Poll the hidden backend audit only while the main toggle is ON.
  // Toggle OFF must not start or keep showing an audit in progress.
  const auditInProgress =
    appEnabled && (expectingAudit || auditStatus?.running === true);

  // The audit is started explicitly from Step 1, never as a side effect of the
  // toggle. A successful `start-audit` response is what puts the dashboard into
  // the polling state. Keyed on the action's confirmed response, never on
  // in-flight formData: an optimistic start would skip the extension check.
  const enablingAudit =
    !extensionBlocked &&
    (auditFetcher?.data?.auditStarted === true ||
      // The toggle action auto-starts a re-run when it flips OFF -> ON, and
      // reports it here. Keyed on the action's confirmed response for the same
      // reason as start-audit: an optimistic start would skip the embed and
      // password checks the action already ran.
      toggleFetcher?.data?.auditStarted === true);

  useEffect(() => {
    setEmbedLive({
      enabled: embedEnabled,
      status: embedStatus,
      url: embedActivateUrl,
    });
  }, [embedEnabled, embedStatus, embedActivateUrl]);

  useEffect(() => {
    setAuditStatus(initialAuditStatus);
  }, [initialAuditStatus]);

  // Light embed re-check on focus; full loader at most once per minute.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void fetch(`/api/embed-status${window.location.search}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((data) => {
          if (!data) return;
          setEmbedLive({
            enabled: data.embedEnabled,
            status: data.embedStatus,
            url: data.embedActivateUrl,
          });
        });
      const now = Date.now();
      if (now - lastFullRevalidateRef.current > 60_000) {
        lastFullRevalidateRef.current = now;
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
        setAuditStatus(data);
        if (data.complete) {
          setExpectingAudit(false);
          if (!completingRef.current && appEnabled && !extensionBlocked) {
            completingRef.current = true;
            void revalidator.revalidate();
            setCurrentStep((step) => (step === 1 ? 3 : step));
          }
        } else if (data.failed) {
          setExpectingAudit(false);
        }
      } catch {
        // transient poll failure — keep showing the loader and keep polling
      }
    };

    poll();
    const timer = setInterval(poll, 2500);
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
          embedEnabled={embedLive.enabled}
          embedStatus={embedLive.status}
          embedActivateUrl={embedLive.url}
          selectedThemeId={selectedThemeId}
          passwordProtected={passwordProtected}
          onAuditRestarted={handleAuditRestarted}
          onAuditStopped={handleAuditStopped}
        />
      )}
      {currentStep === 2 && (
        <Step2Configure
          config={liveConfig}
          appEnabled={appEnabled}
          auditComplete={auditCompleteEffective}
          configLoading={revalidator.state === "loading"}
        />
      )}
      {currentStep === 3 && (
        <Step3AuditResults
          config={liveConfig}
          auditStatus={auditStatus}
          appEnabled={appEnabled}
          passwordProtected={passwordProtected === true}
        />
      )}

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
