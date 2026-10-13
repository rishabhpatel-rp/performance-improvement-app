/**
 * Re-fetch PSI Lighthouse for a shop's last audited URLs (forces throttle bypass).
 *
 *   npx tsx --env-file=.env scripts/refresh-psi.ts rishabh-dev-store-mdqu0epm.myshopify.com
 */
import prisma from "../app/db.server";
import { refreshPsiForShop } from "../app/lib/psi-scheduler.server";
import { loadLatestAuditReport } from "../app/lib/audit-report-summary.server";

const shop = process.argv[2];
if (!shop) {
  console.error("Usage: npx tsx --env-file=.env scripts/refresh-psi.ts <shopDomain>");
  process.exit(1);
}

const report = await loadLatestAuditReport(shop);
const sc = await prisma.storeConfig.findFirst({
  where: { store: { shopDomain: shop } },
  select: { storefrontPassword: true },
});

const pageUrls = (report?.pagesAudited || ["/"]).map((path) => {
  try {
    return new URL(path, `https://${shop}`).href;
  } catch {
    return `https://${shop}${path.startsWith("/") ? path : `/${path}`}`;
  }
});

console.log(`Fetching PSI for ${pageUrls.length} URL(s) (mobile + desktop each)...`);
await refreshPsiForShop(shop, pageUrls, sc?.storefrontPassword ?? null, { force: true });
const count = await prisma.psiSnapshot.count({ where: { shopDomain: shop } });
console.log(`Done. PsiSnapshot rows for shop: ${count}`);

await prisma.$disconnect();
