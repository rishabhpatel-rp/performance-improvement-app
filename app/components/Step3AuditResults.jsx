/* eslint-disable react/prop-types */
import AuditReportPanel from "./AuditReportPanel";

/** Step 3 — PageSpeed-style overview + scripts table only. */
export default function Step3AuditResults({
  config,
  auditReportSummary,
  auditStatus,
  appEnabled,
  passwordProtected = false,
}) {
  return (
    <s-section heading="Step 3: Audit results">
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
