import prisma from "../app/db.server";
import { enqueueAuditJob } from "../app/lib/audit-queue.server";

const shop = process.argv[2];
const count = Number(process.argv[3] || "1");
if (!shop) {
  console.error("Usage: npx tsx --env-file=.env scripts/audit-soak.ts <shopDomain> [count]");
  process.exit(1);
}

const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
if (!store) {
  console.error(`No Store row for ${shop}`);
  process.exit(1);
}

for (let i = 0; i < count; i++) {
  const r = await enqueueAuditJob(shop, store.id, {});
  console.log(`enqueue ${i + 1}:`, r);
}

await prisma.$disconnect();
