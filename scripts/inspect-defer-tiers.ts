import prisma from "../app/db.server";
import { loadLatestAuditReport } from "../app/lib/audit-report-summary.server";

const shop = process.argv[2] || "rishabh-dev-store-mdqu0epm.myshopify.com";

const store = await prisma.store.findUnique({
  where: { shopDomain: shop },
});
if (!store) {
  console.error("No store for", shop);
  process.exit(1);
}
const cfg = await prisma.storeConfig.findUnique({ where: { storeId: store.id } });
if (!cfg) {
  console.error("No store config for", shop);
  process.exit(1);
}

const report = await loadLatestAuditReport(shop);

console.log(
  JSON.stringify(
    {
      shop,
      auditComplete: cfg.auditComplete,
      auditRunning: cfg.auditRunning,
      deferInteraction: (cfg.auditDeferArray as string[])?.length ?? 0,
      delayEveryStore: (cfg.staticDeferDefaults as string[])?.length ?? 0,
      delayFirstStore: (cfg.firstUserDelayScripts as string[])?.length ?? 0,
      hideSelectors: (cfg.auditHideSelectors as string[])?.length ?? 0,
      reportDefer: report?.deferArray?.length ?? 0,
      reportDelayEvery: report?.delayEveryArray?.length ?? 0,
      reportDelayFirst: report?.delayFirstArray?.length ?? 0,
      warnings: report?.warnings ?? [],
    },
    null,
    2,
  ),
);

if (report?.delayEveryArray?.length) {
  console.log("sample delay-every:", report.delayEveryArray.slice(0, 8));
}
if (report?.delayFirstArray?.length) {
  console.log("sample delay-first:", report.delayFirstArray.slice(0, 8));
}

const inv = report?.scriptInventory?.byToken ?? [];
const tierCounts: Record<string, number> = {};
for (const e of inv) {
  const k = e.deferTier ?? "(none)";
  tierCounts[k] = (tierCounts[k] ?? 0) + 1;
}
if (Object.keys(tierCounts).length) {
  console.log("inventory deferTier counts:", tierCounts);
}

await prisma.$disconnect();
