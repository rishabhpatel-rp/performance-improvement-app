import prisma from "../db.server";
import { loadLatestAuditReport, buildAuditReportSummary } from "./audit-report-summary.server";
import { PSI_SKIP_PASSWORD_STORE_NOTE, shouldSkipPsiFetch } from "./psi.server";
import {
  buildPageSpeedViews,
  loadPsiSnapshotsForShop,
  refreshPsiForShop,
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
  let psiRows = psiSkipForPassword
    ? []
    : await loadPsiSnapshotsForShop(shopDomain, 24);

  let psiStatusNote;
  if (!psiSkipForPassword && psiRows.length === 0 && latestReport.pagesAudited?.length) {
    const pageUrls = (latestReport.pagesAudited || []).map((path) => {
      try {
        return new URL(path, `https://${shopDomain}`).href;
      } catch {
        return `https://${shopDomain}${path.startsWith("/") ? path : `/${path}`}`;
      }
    });
    const passwordRow = await prisma.store.findUnique({
      where: { shopDomain },
      select: { configs: { select: { storefrontPassword: true }, take: 1 } },
    });
    void refreshPsiForShop(
      shopDomain,
      pageUrls.length ? pageUrls : [`https://${shopDomain}/`],
      passwordRow?.configs?.[0]?.storefrontPassword ?? null,
      { force: true },
    ).catch((err) => {
      console.warn(
        "[dashboard-report] PSI refresh:",
        err instanceof Error ? err.message : err,
      );
    });
    psiStatusNote =
      fieldVitals?.note ??
      "Fetching PageSpeed Insights scores (rings and TBT/SI). This can take 1–2 minutes — stay on this page or refresh.";
  } else if (!psiSkipForPassword && psiRows.length === 0 && fieldVitals?.note) {
    psiStatusNote = fieldVitals.note;
  }
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
    psiSkipForPassword
      ? PSI_SKIP_PASSWORD_STORE_NOTE
      : psiStatusNote,
  );
}
