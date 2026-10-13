import prisma from "../app/db.server";
import {
  buildAuditReportSummary,
  loadLatestAuditReport,
} from "../app/lib/audit-report-summary.server";
import {
  buildPageSpeedViews,
  loadPsiSnapshotsForShop,
} from "../app/lib/psi-scheduler.server";

const shop = process.argv[2] || "rishabh-dev-store-mdqu0epm.myshopify.com";

const report = await loadLatestAuditReport(shop);
if (!report) {
  console.error("No completed audit report");
  process.exit(1);
}

const psiRows = await loadPsiSnapshotsForShop(shop, 24);
const pagesForPsi = (report.pagesAudited || []).map((path) => ({
  label:
    path === "/"
      ? "Home"
      : path.includes("/products/")
        ? "Product"
        : path.includes("/collections/")
          ? "Collection"
          : path,
  path,
}));

const pageSpeedViews = buildPageSpeedViews(pagesForPsi, psiRows);
const summary = buildAuditReportSummary(report, null, [], pageSpeedViews);

console.log("auditComplete paths:", report.pagesAudited);
console.log("psi snapshots:", psiRows.length);
for (const v of summary.pageSpeedViews || []) {
  const m = v.mobile?.categories;
  const d = v.desktop?.categories;
  console.log(
    `- ${v.label} (${v.path}): mobile perf=${m?.performance ?? "—"} desktop=${d?.performance ?? "—"} LCP=${v.mobile?.metrics?.lcpSec ?? "—"}s`,
  );
}

const anyScores = summary.pageSpeedViews?.some(
  (v) => v.mobile?.categories?.performance != null,
);
console.log(anyScores ? "OK: Overview would show gauges" : "FAIL: no PSI scores in summary");

await prisma.$disconnect();
process.exit(anyScores ? 0 : 1);
