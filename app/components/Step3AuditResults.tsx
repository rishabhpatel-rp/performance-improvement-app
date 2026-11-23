/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy components */
import { useEffect } from "react";
import { useFetcher } from "react-router";
import AuditReportPanel from "./AuditReportPanel";
import Skeleton from "./Skeleton";
import SupportError from "./SupportError.tsx";

interface Props {
  config?: Record<string, unknown> | null;
  auditStatus?: { complete?: boolean } | null;
  appEnabled?: boolean;
  scope?: string;
  readOnly?: boolean;
}

/** Scan summary — the script table from the latest PagePulse audit. */
export default function Step3AuditResults({
  config,
  auditStatus,
  appEnabled,
  scope = "global",
}: Props) {
  const reportFetcher = useFetcher();
  const reportUrl = `/api/dashboard-report${window.location.search}`;
  const reportLoading = reportFetcher.state !== "idle" && !reportFetcher.data?.auditReportSummary;

  useEffect(() => {
    void reportFetcher.load(reportUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the summary mounts
  }, []);

  useEffect(() => {
    if (!auditStatus?.complete) return;
    void reportFetcher.load(reportUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh when audit finishes
  }, [auditStatus?.complete]);

  const auditReportSummary = reportFetcher.data?.auditReportSummary ?? null;
  const reportFailed = reportFetcher.data && reportFetcher.data.ok === false;

  if (reportLoading) return <Skeleton lines={5} label="Loading audit report" />;
  if (reportFailed) {
    return (
      <SupportError
        title="We couldn't load your scan summary"
        error={reportFetcher.data?.error}
        onRetry={() => void reportFetcher.load(reportUrl)}
      />
    );
  }

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
        scope={scope}
      />
    </div>
  );
}
