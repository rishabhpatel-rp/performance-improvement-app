/**
 * Postgres integration tests (run: npm run test:integration).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import prisma from "../app/db.server";
import { claimNextAuditJob, recoverAuditJobsOnBoot } from "../app/lib/audit-queue.server";

const canRun = Boolean(process.env.DATABASE_URL);
const tag = `audit-integ-${Date.now()}`;

async function createTestStore(suffix: string) {
  const shopDomain = `${tag}-${suffix}.myshopify.com`;
  return prisma.store.create({
    data: {
      shopifyShopId: `gid://${suffix}-${tag}`,
      shopDomain,
      shopName: `Test ${suffix}`,
      email: `test-${suffix}@example.com`,
    },
  });
}

const storeIds: string[] = [];

if (canRun) {
  before(async () => {
    const s1 = await createTestStore("a");
    const s2 = await createTestStore("b");
    storeIds.push(s1.id, s2.id);
    await prisma.storeConfig.createMany({
      data: storeIds.map((storeId) => ({
        storeId,
        appEnabled: false,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: [],
      })),
    });
  });

  after(async () => {
    await prisma.auditJob.deleteMany({
      where: { storeId: { in: storeIds } },
    });
    await prisma.storeConfig.deleteMany({
      where: { storeId: { in: storeIds } },
    });
    await prisma.store.deleteMany({ where: { id: { in: storeIds } } });
    await prisma.$disconnect();
  });
}

void test("up to four jobs claim in parallel when global cap is 4", { skip: !canRun }, async () => {
  if (!canRun) return;
  const stores = await prisma.store.findMany({
    where: { id: { in: storeIds } },
  });
  await prisma.auditJob.deleteMany({ where: { storeId: { in: storeIds } } });

  for (const s of stores) {
    await prisma.auditJob.create({
      data: {
        storeId: s.id,
        shopDomain: s.shopDomain,
        status: "queued",
        priority: 0,
      },
    });
  }

  const claimed: string[] = [];
  for (let i = 0; i < 6; i++) {
    const job = await claimNextAuditJob();
    if (job?.id) claimed.push(job.id);
  }
  assert.ok(claimed.length >= 2, `expected parallel claims, got ${claimed.length}`);
  assert.ok(claimed.length <= 4, `expected cap of 4, got ${claimed.length}`);

  await prisma.auditJob.updateMany({
    where: { id: { in: claimed } },
    data: { status: "failed", lockedAt: null },
  });
});

void test("recoverAuditJobsOnBoot requeues stale running job", { skip: !canRun }, async () => {
  if (!canRun) return;
  const store = await prisma.store.findFirst({
    where: { id: storeIds[0] },
  });
  assert.ok(store);
  await prisma.auditJob.deleteMany({ where: { storeId: store!.id } });

  const job = await prisma.auditJob.create({
    data: {
      storeId: store!.id,
      shopDomain: store!.shopDomain,
      status: "running",
      workerId: "stale-worker-not-local",
      lockedAt: new Date(Date.now() - 60 * 60 * 1000),
      attempts: 1,
      maxAttempts: 2,
    },
  });

  await recoverAuditJobsOnBoot();

  const after = await prisma.auditJob.findUnique({ where: { id: job.id } });
  assert.equal(after?.status, "queued");
  assert.equal(after?.workerId, null);
});
