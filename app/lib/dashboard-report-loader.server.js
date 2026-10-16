import prisma from "../db.server";
import { loadLatestAuditReport, buildAuditReportSummary } from "./audit-report-summary.server";

/** Scan-summary payload — scripts from the PagePulse audit, not PageSpeed Insights. */
export async function loadDashboardAuditReportSummary(shopDomain) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      configs: {
        select: { auditComplete: true },
        take: 1,
      },
    },
  });
  const sc = store?.configs?.[0];
  if (!sc?.auditComplete) return null;

  const latestReport = await loadLatestAuditReport(shopDomain);
  if (!latestReport) return null;

  return buildAuditReportSummary(latestReport);
}
