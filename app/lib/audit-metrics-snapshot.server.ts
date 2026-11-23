import prisma from "../db.server";
import { hostMemoryUseRatio } from "./audit-host-memory.server";
import { getAuditDrainDiagnostics } from "./audit-queue.server";
import { workerInstanceId } from "./audit-env.server";
import { getWorkerHeartbeatStatus } from "./worker-heartbeat.server";

export async function getAuditQueueMetrics() {
  const now = Date.now();
  const [queued, running, oldest, failures24h, workerHeartbeat] = await Promise.all([
    prisma.auditJob.count({ where: { status: "queued" } }),
    prisma.auditJob.count({ where: { status: "running" } }),
    prisma.auditJob.findFirst({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    prisma.auditJob.groupBy({
      by: ["errorCode"],
      where: {
        status: "failed",
        finishedAt: { gte: new Date(now - 24 * 60 * 60 * 1000) },
      },
      _count: { _all: true },
    }),
    getWorkerHeartbeatStatus(),
  ]);

  const oldestQueuedAgeMs = oldest?.createdAt ? now - oldest.createdAt.getTime() : null;

  return {
    ok: true,
    serverNow: now,
    workerId: workerInstanceId(),
    queue: {
      depth: queued,
      running,
      oldestQueuedAgeMs,
    },
    memory: {
      useRatio: hostMemoryUseRatio(),
    },
    drain: getAuditDrainDiagnostics(),
    workerHeartbeat,
    failuresByCode24h: Object.fromEntries(
      failures24h.map(
        (row: { errorCode: string | null; _count: { _all: number } }) =>
          [row.errorCode ?? "UNKNOWN", row._count._all] as const,
      ),
    ),
  };
}
