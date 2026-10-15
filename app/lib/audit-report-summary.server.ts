import type { HiddenAuditResult } from "./audit.server";
import type {
  AuditReportSummary,
  FieldVitalsSummary,
  LighthouseUiView,
  PageSpeedPageView,
} from "./audit-report-types";

const DEFAULT_LIMITS = [
  "Sample: home + one collection + one product (or merchant URLs).",
  "Lab vitals: PagePulse mobile profile (mobile viewport, Slow 4G + CPU 4×) — not CrUX.",
  "Defer/hide lists are conservative; short lists are often correct.",
  "/cart and cookie-banner passes are out of scope for this epic.",
];

const STALE_SCAN_MS = 30 * 24 * 60 * 60 * 1000;

export function labVitalsToLighthouseView(
  path: string,
  lab?: import("./audit-report-types").LabVitalsEntry,
): LighthouseUiView | undefined {
  if (!lab) return undefined;
  return {
    source: "lab",
    categories: { performance: undefined },
    metrics: {
      fcpSec: lab.fcp != null ? lab.fcp / 1000 : undefined,
      lcpSec: lab.lcp != null ? lab.lcp / 1000 : undefined,
      cls: lab.cls != null ? (lab.cls > 1 ? lab.cls / 1000 : lab.cls) : undefined,
      tbtMs: undefined,
      speedIndexSec: undefined,
    },
    note:
      "PagePulse lab metrics only — Performance / SEO rings and TBT / SI need PageSpeed Insights (runs after scan).",
  };
}

export function mergePageSpeedWithLab(
  views: PageSpeedPageView[],
  labVitalsByPath?: Record<string, import("./audit-report-types").LabVitalsEntry>,
): PageSpeedPageView[] {
  if (!labVitalsByPath) return views;
  return views.map((v) => {
    const lab = labVitalsByPath[v.path] ?? (v.path === "/" ? labVitalsByPath["/index"] : undefined);
    const labView = labVitalsToLighthouseView(v.path, lab);
    return {
      ...v,
      mobile:
        v.mobile?.categories?.performance != null
          ? v.mobile
          : (labView ?? v.mobile),
      desktop: v.desktop ?? undefined,
    };
  });
}

export function buildAuditReportSummary(
  report: HiddenAuditResult,
  fieldVitals?: FieldVitalsSummary | null,
  psiByUrl?: AuditReportSummary["psiByUrl"],
  pageSpeedViews?: PageSpeedPageView[],
  psiSkipNote?: string,
): AuditReportSummary {
  const funnel = report.funnel || [];
  const request = funnel.reduce((s, f) => s + (f.request || 0), 0);
  const candidates = funnel.reduce((s, f) => s + (f.candidates || 0), 0);
  const emitted = funnel.reduce((s, f) => s + (f.emitted || 0), 0);

  const inv = report.scriptInventory;
  const topScripts = (inv?.byToken || []).map((e) => ({
      token: e.token,
      kb: e.bytes != null ? Math.round(e.bytes / 1024) : null,
      durationMs: e.durationMs ?? null,
      status: e.status,
      reasons: e.reasons ?? [],
      pages: e.pages,
      homeRequestOrder: e.homeRequestOrder ?? null,
      homeStartMs: e.homeStartMs ?? null,
    }));

  const scriptsSeen = inv?.totals?.scriptRequests ?? request;
  const deferred = report.deferArray?.length ?? 0;
  const protectedCount =
    inv?.totals?.protectedTokenCount ??
    Math.max(0, candidates - emitted);

  const completedAt = report.completedAt;
  const staleScanWarning =
    Date.now() - new Date(completedAt).getTime() > STALE_SCAN_MS;
  const homeVitals = report.labVitalsByPath?.["/"] ?? report.labVitalsByPath?.["/index"];

  return {
    completedAt,
    pages: (report.pagesAudited || []).map((path) => ({
      label: path === "/" ? "Home" : path,
      path,
    })),
    foldAssertionOk: report.foldAssertion?.ok ?? true,
    foldViolations: report.foldAssertion?.violations ?? [],
    warnings: report.warnings ?? [],
    stats: {
      scriptsSeen,
      deferred,
      protected: protectedCount,
      hiddenSelectors: report.hideSelectors?.length ?? 0,
      popups: report.popupSelectors?.length ?? 0,
    },
    funnelSteps: { request, candidates, emitted },
    topScripts,
    labVitalsByPath: report.labVitalsByPath,
    gateImpact: report.gateImpact,
    fieldVitals: fieldVitals ?? report.fieldVitals,
    limits: [...DEFAULT_LIMITS, ...(report.limits || [])],
    popupSelectors: report.popupSelectors ?? [],
    auditRunMeta: report.auditRunMeta,
    staleScanWarning,
    homeLongTaskCount: homeVitals?.longTaskCount ?? null,
    psiByUrl,
    pageSpeedViews: mergePageSpeedWithLab(
      pageSpeedViews ?? [],
      report.labVitalsByPath,
    ),
    psiSkipNote,
    templateBuckets: report.templateBuckets
      ? {
          defer: {
            global: report.templateBuckets.defer.global ?? [],
            home: report.templateBuckets.defer.home ?? [],
            collection: report.templateBuckets.defer.collection ?? [],
            product: report.templateBuckets.defer.product ?? [],
          },
          hide: {
            global: report.templateBuckets.hide.global ?? [],
            home: report.templateBuckets.hide.home ?? [],
            collection: report.templateBuckets.hide.collection ?? [],
            product: report.templateBuckets.hide.product ?? [],
          },
        }
      : undefined,
    pageRoles: report.pageRoles,
  };
}

export async function loadLatestAuditReport(shopDomain: string) {
  const prisma = (await import("../db.server")).default;
  const row = await prisma.auditLog.findFirst({
    where: { domain: shopDomain, status: "completed" },
    orderBy: { timestamp: "desc" },
  });
  if (!row?.audit_data) return null;
  return row.audit_data as HiddenAuditResult;
}
