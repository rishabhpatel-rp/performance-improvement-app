import prisma from "../app/db.server.js";

const running = await prisma.auditJob.findMany({
  where: { status: "running" },
  select: { id: true, shopDomain: true, lockedAt: true },
});

for (const j of running) {
  await prisma.auditJob.update({
    where: { id: j.id },
    data: {
      status: "failed",
      lockedAt: null,
      errorCode: "WORKER_LOST",
      lastError: "manual cleanup",
      finishedAt: new Date(),
    },
  });
  console.log("failed", j.shopDomain, j.id);
}

console.log("cleared", running.length, "running job(s)");
await prisma.$disconnect();
