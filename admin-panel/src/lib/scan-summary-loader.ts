import { prisma } from "./prisma";
import type { AuditSummaryPayload } from "@/components/step2/step2-audit-table";

const STALE_SCAN_MS = 30 * 24 * 60 * 60 * 1000;

type AuditData = {
  pagesAudited?: string[];
  scriptInventory?: { byToken?: Array<Record<string, unknown>> };
  foldAssertion?: { ok?: boolean; violations?: unknown[] };
  pageRoles?: Record<string, string>;
  completedAt?: string;
};

function mapTopScripts(byToken: Array<Record<string, unknown>> | undefined) {
  if (!Array.isArray(byToken)) return [];
  return byToken.map((e) => ({
    token: String(e.token ?? ""),
    kb: typeof e.bytes === "number" ? Math.round((e.bytes as number) / 1024) : undefined,
    bytes: typeof e.bytes === "number" && (e.bytes as number) > 0 ? (e.bytes as number) : undefined,
    durationMs: typeof e.durationMs === "number" ? e.durationMs : undefined,
    status: String(e.status ?? ""),
    reasons: Array.isArray(e.reasons) ? (e.reasons as string[]) : [],
    pages: Array.isArray(e.pages) ? (e.pages as string[]) : [],
    domain: typeof e.domain === "string" ? e.domain : undefined,
    homeRequestOrder: typeof e.homeRequestOrder === "number" ? e.homeRequestOrder : undefined,
    homeStartMs: typeof e.homeStartMs === "number" ? e.homeStartMs : undefined,
    scriptCategory: typeof e.scriptCategory === "string" ? e.scriptCategory : undefined,
    deferTier: typeof e.deferTier === "string" ? e.deferTier : undefined,
    deferConfidence: typeof e.deferConfidence === "number" ? e.deferConfidence : undefined,
    riskLabel: typeof e.riskLabel === "string" ? e.riskLabel : undefined,
    storefrontImpact: typeof e.storefrontImpact === "string" ? e.storefrontImpact : undefined,
  }));
}

/** DB-backed scan summary for Step 2 (works even when merchant dev URL is stale). */
export async function loadScanSummaryForStore(
  shopDomain: string,
): Promise<AuditSummaryPayload | null> {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      configs: { select: { auditComplete: true }, take: 1 },
    },
  });
  if (!store?.configs?.[0]?.auditComplete) return null;

  const row = await prisma.auditLog.findFirst({
    where: { domain: shopDomain, status: "completed" },
    orderBy: { timestamp: "desc" },
    select: { timestamp: true, audit_data: true },
  });
  if (!row?.audit_data || typeof row.audit_data !== "object") return null;

  const report = row.audit_data as AuditData;
  const completedAt =
    typeof report.completedAt === "string" ? report.completedAt : row.timestamp.toISOString();
  const staleScanWarning = Date.now() - new Date(completedAt).getTime() > STALE_SCAN_MS;

  return {
    completedAt,
    pages: (report.pagesAudited ?? []).map((path) => ({
      label: path === "/" ? "Home" : path,
      path,
    })),
    topScripts: mapTopScripts(report.scriptInventory?.byToken),
    pageRoles: report.pageRoles,
    staleScanWarning,
    foldAssertionOk: report.foldAssertion?.ok ?? true,
    foldViolations: report.foldAssertion?.violations ?? [],
  };
}
