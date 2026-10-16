/* eslint-disable react/prop-types */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import AuditReportPanel from "./AuditReportPanel";

/** Scan summary — the script table from the latest PagePulse audit. */
export default function Step3AuditResults({
  config,
  auditStatus,
  appEnabled,
}) {
  const reportFetcher = useFetcher();
  const reportUrl = `/api/dashboard-report${window.location.search}`;
  const reportLoading =
    reportFetcher.state !== "idle" && !reportFetcher.data?.auditReportSummary;

  useEffect(() => {
    reportFetcher.load(reportUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the summary mounts
  }, []);

  useEffect(() => {
    if (!auditStatus?.complete) return;
    reportFetcher.load(reportUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when audit finishes
  }, [auditStatus?.complete]);

  const auditReportSummary = reportFetcher.data?.auditReportSummary ?? null;

  return (
    <div>
      {reportLoading && !auditReportSummary && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <s-spinner size="small" />
          <s-text tone="subdued">Loading scan summary…</s-text>
        </div>
      )}
      <AuditReportPanel
        summary={auditReportSummary}
        auditStatus={auditStatus}
        appEnabled={appEnabled}
        templateConfig={config}
      />
    </div>
  );
}
