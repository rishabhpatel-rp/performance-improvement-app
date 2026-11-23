import prisma from "../app/db.server.js";

const jobs = await prisma.auditJob.findMany({
  orderBy: { createdAt: "desc" },
  take: 5,
  select: {
    id: true,
    status: true,
    errorCode: true,
    shopDomain: true,
    updatedAt: true,
  },
});

console.log(JSON.stringify(jobs, null, 2));
await prisma.$disconnect();
