import { prisma } from "./prisma";

export type AuditFleetSummary = {
  queued: number;
  running: number;
  failedLast24h: number;
  oldestQueuedMinutes: number | null;
  runningShops: { shopDomain: string; startedAt: string | null }[];
};

export async function getAuditFleetSummary(): Promise<AuditFleetSummary> {
  const now = Date.now();
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [queued, running, failedLast24h, oldest, runningJobs] = await Promise.all([
    prisma.auditJob.count({ where: { status: "queued" } }),
    prisma.auditJob.count({ where: { status: "running" } }),
    prisma.auditJob.count({
      where: { status: "failed", finishedAt: { gte: dayAgo } },
    }),
    prisma.auditJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.auditJob.findMany({
      where: { status: "running" },
      orderBy: { startedAt: "asc" },
      take: 8,
      select: { shopDomain: true, startedAt: true },
    }),
  ]);

  return {
    queued,
    running,
    failedLast24h,
    oldestQueuedMinutes: oldest?.createdAt
      ? Math.round((now - oldest.createdAt.getTime()) / 60_000)
      : null,
    runningShops: runningJobs.map((j) => ({
      shopDomain: j.shopDomain,
      startedAt: j.startedAt?.toISOString() ?? null,
    })),
  };
}
