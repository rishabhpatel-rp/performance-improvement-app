import { getEnv } from "./env.server.ts";
import prisma from "../db.server";
import { MAX_CONCURRENT_AUDITS } from "./audit-queue-policy";
import { isJobAheadInQueue } from "./audit-queue-position";
import { QUEUE_ETA_MINUTES_PER_SHOP } from "./constants.ts";

const ETA_MINUTES_PER_SHOP = Math.max(
  5,
  getEnv().AUDIT_ETA_MINUTES_PER_SHOP || QUEUE_ETA_MINUTES_PER_SHOP,
);

export type ShopQueueSnapshot = {
  queueDepth: number;
  runningCount: number;
  queuePosition: number | null;
  shopsAhead: number;
  estimatedWaitMinutes: number | null;
};

export async function getShopQueueSnapshot(
  storeId: string,
  activeJobId: string | null | undefined,
  auditPhase: string | null | undefined,
): Promise<ShopQueueSnapshot | null> {
  if (auditPhase !== "queued" || !activeJobId) return null;

  const job = await prisma.auditJob.findUnique({
    where: { id: activeJobId },
    select: { id: true, status: true, priority: true, createdAt: true },
  });
  if (!job || job.status !== "queued") return null;

  const createdAtMs = job.createdAt.getTime();
  const queuedPeers = await prisma.auditJob.findMany({
    where: { status: "queued", stopRequested: false },
    select: { priority: true, createdAt: true },
  });

  const shopsAhead = queuedPeers.filter((peer: { priority: number; createdAt: Date }) =>
    isJobAheadInQueue(
      { priority: peer.priority, createdAtMs: peer.createdAt.getTime() },
      { priority: job.priority, createdAtMs },
    ),
  ).length;

  const [queueDepth, runningCount] = await Promise.all([
    prisma.auditJob.count({ where: { status: "queued" } }),
    prisma.auditJob.count({ where: { status: "running" } }),
  ]);

  const runningSlotsBusy = runningCount >= MAX_CONCURRENT_AUDITS;
  const waitSlots = shopsAhead + (runningSlotsBusy ? 1 : 0);

  return {
    queueDepth,
    runningCount,
    queuePosition: shopsAhead + 1,
    shopsAhead,
    estimatedWaitMinutes: waitSlots > 0 ? waitSlots * ETA_MINUTES_PER_SHOP : null,
  };
}

export { isJobAheadInQueue } from "./audit-queue-position";
