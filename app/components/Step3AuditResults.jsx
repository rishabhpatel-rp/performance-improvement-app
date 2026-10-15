/* eslint-disable react/prop-types */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import AuditReportPanel from "./AuditReportPanel";

/** Step 3 — PageSpeed-style overview + scripts table only. */
export default function Step3AuditResults({
  config,
  auditStatus,
  appEnabled,
  passwordProtected = false,
}) {
  const reportFetcher = useFetcher();
  const reportUrl = `/api/dashboard-report${window.location.search}`;
  const reportLoading =
    reportFetcher.state !== "idle" && !reportFetcher.data?.auditReportSummary;

  useEffect(() => {
    reportFetcher.load(reportUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when Step 3 mounts
  }, []);

  useEffect(() => {
    if (!auditStatus?.complete) return;
    reportFetcher.load(reportUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when audit finishes
  }, [auditStatus?.complete]);

  const auditReportSummary = reportFetcher.data?.auditReportSummary ?? null;

  const mobilePsi = auditReportSummary?.pageSpeedViews?.[0]?.mobile;
  const psiPending = Boolean(
    !passwordProtected &&
      auditReportSummary?.pageSpeedViews?.length &&
      !(mobilePsi?.source === "psi" && mobilePsi?.categories?.performance != null),
  );

  // Poll while Overview shows lab-only metrics. Depend on the boolean, not the
  // summary object: each load replaces that object and was resetting the cap,
  // so Step 3 refetched the report (and kicked another PSI job) forever.
  useEffect(() => {
    if (!psiPending) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > 10) {
        clearInterval(timer);
        return;
      }
      reportFetcher.load(reportUrl);
    }, 25_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll until PSI scores land
  }, [psiPending, reportUrl]);

  return (
    <s-section heading="Step 3: Audit results">
      {reportLoading && !auditReportSummary && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <s-spinner size="small" />
          <s-text tone="subdued">Loading audit report…</s-text>
        </div>
      )}
      <AuditReportPanel
        summary={auditReportSummary}
        auditStatus={auditStatus}
        appEnabled={appEnabled}
        passwordProtected={passwordProtected}
        templateConfig={config}
      />
    </s-section>
  );
}
