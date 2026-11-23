/**
 * Run a full hidden audit in-process (latest code). Use when the merchant dev
 * process is also draining the DB queue and you need this checkout's logic.
 */
import prisma from "../app/db.server";
import { executeAuditRun } from "../app/lib/audit-execute.server";
import { resolveShopAdmin } from "../app/lib/internal-shop-session.server";

const shop = process.argv[2] || "rishabh-dev-store-mdqu0epm.myshopify.com";

const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
if (!store) {
  console.error("Store not found:", shop);
  process.exit(1);
}

const admin = await resolveShopAdmin(shop);
if (!admin.ok) {
  console.error("No admin session:", admin.error);
  process.exit(1);
}

await prisma.storeConfig.update({
  where: { storeId: store.id },
  data: { auditRunning: true, auditFailed: false, auditError: null },
});

console.log("[direct-audit] starting", shop);
const started = Date.now();
const result = await executeAuditRun({
  storeId: store.id,
  shopDomain: shop,
  admin: admin.admin,
});
console.log("[direct-audit] done", result, `in ${Math.round((Date.now() - started) / 1000)}s`);

await prisma.$disconnect();
process.exit(result.ok ? 0 : 1);
