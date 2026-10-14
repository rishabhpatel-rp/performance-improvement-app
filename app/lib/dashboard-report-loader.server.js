import prisma from "../db.server";
import { loadLatestAuditReport, buildAuditReportSummary } from "./audit-report-summary.server";
import { PSI_SKIP_PASSWORD_STORE_NOTE, shouldSkipPsiFetch } from "./psi.server";
import {
  buildPageSpeedViews,
  loadPsiSnapshotsForShop,
} from "./psi-scheduler.server";

/** Heavy Step 3 payload — not run on the main dashboard loader. */
export async function loadDashboardAuditReportSummary(shopDomain) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      configs: {
        select: {
          auditComplete: true,
          psiFieldVitals: true,
          isPasswordProtected: true,
        },
        take: 1,
      },
    },
  });
  const sc = store?.configs?.[0];
  if (!sc?.auditComplete) return null;

  const latestReport = await loadLatestAuditReport(shopDomain);
  if (!latestReport) return null;

  const fieldVitals =
    sc.psiFieldVitals && typeof sc.psiFieldVitals === "object"
      ? sc.psiFieldVitals
      : null;
  const psiSkipForPassword = shouldSkipPsiFetch(sc?.isPasswordProtected);
  const psiRows = psiSkipForPassword
    ? []
    : await loadPsiSnapshotsForShop(shopDomain, 24);
  const psiByUrl = psiRows.map((row) => ({
    url: row.url,
    fieldSource: row.fieldSource,
    lcp: row.lcp,
  }));
  const pagesForPsi = (latestReport.pagesAudited || []).map((path) => ({
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

  return buildAuditReportSummary(
    latestReport,
    fieldVitals,
    psiSkipForPassword ? [] : psiByUrl,
    pageSpeedViews,
    psiSkipForPassword ? PSI_SKIP_PASSWORD_STORE_NOTE : undefined,
  );
}
