import prisma from "../app/db.server";

const shop = process.argv[2] || "rishabh-dev-store-mdqu0epm.myshopify.com";

const store = await prisma.store.findUnique({ where: { shopDomain: shop } });
if (!store) {
  console.error("No store");
  process.exit(1);
}
const cfg = await prisma.storeConfig.findUnique({ where: { storeId: store.id } });
const job = await prisma.auditJob.findFirst({
  where: { storeId: store.id },
  orderBy: { createdAt: "desc" },
});

console.log(
  JSON.stringify(
    {
      shop,
      job: job
        ? {
            id: job.id,
            status: job.status,
            workerId: job.workerId,
            updatedAt: job.updatedAt,
            errorCode: job.errorCode,
          }
        : null,
      auditRunning: cfg?.auditRunning,
      auditPhase: cfg?.auditPhase,
      auditPageIndex: cfg?.auditPageIndex,
      auditTotalPages: cfg?.auditTotalPages,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
