import { buildAuditReportSummary } from "./audit-report-summary.server.ts";
import type { HiddenAuditResult } from "./audit-core.ts";

export type CustomAuditSummary = {
  completedAt?: string;
  pages?: { label: string; path: string }[];
  topScripts?: ReturnType<typeof buildAuditReportSummary>["topScripts"];
  pageRoles?: Record<string, string>;
  foldAssertionOk?: boolean;
  foldViolations?: unknown[];
  staleScanWarning?: boolean;
};

export function auditDataToSummaryPayload(report: HiddenAuditResult): CustomAuditSummary {
  const full = buildAuditReportSummary(report);
  return {
    completedAt: full.completedAt,
    pages: full.pages,
    topScripts: full.topScripts,
    pageRoles: full.pageRoles,
    foldAssertionOk: report.foldAssertion?.ok,
    foldViolations: report.foldAssertion?.violations,
    staleScanWarning: false,
  };
}
