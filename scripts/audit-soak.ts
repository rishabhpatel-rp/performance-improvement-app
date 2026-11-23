import prisma from "../app/db.server";
import { enqueueAuditJob } from "../app/lib/audit-queue.server";
import { getAuditQueueMetrics } from "../app/lib/audit-metrics-snapshot.server";

const shop = process.argv[2];
const count = Number(process.argv[3] || "1");
const watchMs = Number(process.argv[4] || "0");

if (!shop) {
  console.error(
    "Usage: npx tsx --env-file=.env scripts/audit-soak.ts <shopDomain> [enqueueCount] [watchMs]",
  );
  process.exit(1);
}

const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
if (!store) {
  console.error(`No Store row for ${shop}`);
  process.exit(1);
}

console.log(JSON.stringify(await getAuditQueueMetrics(), null, 2));

for (let i = 0; i < count; i++) {
  const r = await enqueueAuditJob(shop, store.id, {
    trigger: "soak",
    force: true,
  });
  console.log(`enqueue ${i + 1}:`, r);
}

if (watchMs > 0) {
  const deadline = Date.now() + watchMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 5000));
    const m = await getAuditQueueMetrics();
    console.log(
      `[soak] queued=${m.queue.depth} running=${m.queue.running} oldestMs=${m.queue.oldestQueuedAgeMs}`,
    );
    if (m.queue.depth === 0 && m.queue.running === 0) break;
  }
}

console.log(JSON.stringify(await getAuditQueueMetrics(), null, 2));
await prisma.$disconnect();
