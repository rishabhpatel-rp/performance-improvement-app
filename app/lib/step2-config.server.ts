import prisma from "../db.server";
import { loadDashboardAuditReportSummary } from "./dashboard-report-loader.server";
import { buildStep2Config, buildStep2Version } from "./step2-config";
import { loadStoreControlHealth } from "./store-control-health.server";

type StoreConfigRow = Record<string, unknown>;

export { buildStep2Config, buildStep2Version } from "./step2-config";

export async function loadStep2WriteEcho(shopDomain: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    include: { configs: { take: 1 }, performanceScript: true },
  });
  if (!store) return null;
  const sc = store.configs[0] as StoreConfigRow | undefined;
  return {
    config: buildStep2Config(sc),
    version: buildStep2Version(store, sc, store.performanceScript),
  };
}

export async function loadStoreStep2Snapshot(shopDomain: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    include: { configs: { take: 1 }, performanceScript: true },
  });
  if (!store?.configs?.[0]) return null;
  const sc = store.configs[0] as StoreConfigRow;
  const auditStatus = {
    running: sc.auditRunning === true,
    complete: sc.auditComplete === true,
    failed: sc.auditFailed === true,
  };
  const auditReportSummary = await loadDashboardAuditReportSummary(shopDomain);
  const health = await loadStoreControlHealth(shopDomain);
  const customExtras = Array.isArray(sc.customPageUrls)
    ? (sc.customPageUrls as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return {
    config: buildStep2Config(sc),
    auditStatus,
    auditReportSummary,
    health,
    setup: {
      hasStorefrontPassword: Boolean(
        typeof sc.storefrontPassword === "string" && sc.storefrontPassword.length > 0,
      ),
      customPlpUrl: typeof sc.customPlpUrl === "string" ? sc.customPlpUrl : "",
      customPdpUrl: typeof sc.customPdpUrl === "string" ? sc.customPdpUrl : "",
      customPageUrls: customExtras,
      auditError: typeof sc.auditError === "string" ? sc.auditError : null,
      auditPhase: typeof sc.auditPhase === "string" ? sc.auditPhase : null,
    },
    version: buildStep2Version(
      store,
      sc as { updatedAt?: Date; appEnabled?: boolean },
      store.performanceScript,
    ),
  };
}

/**
 * Merges the freshly stored config into a write response so a caller can
 * re-render from the saved state instead of its optimistic copy.
 */
export async function withStep2Echo<T extends Record<string, unknown>>(
  shopDomain: string,
  payload: T,
) {
  const echo = await loadStep2WriteEcho(shopDomain);
  return echo ? { ...payload, ...echo } : payload;
}
