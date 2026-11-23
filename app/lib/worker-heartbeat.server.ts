import prisma from "../db.server";
import {
  auditWorkerDrainEnabled,
  isDbAuditQueueEnabled,
  workerInstanceId,
} from "./audit-env.server";
import { WORKER_HEARTBEAT_STALE_MS, WORKER_HEARTBEAT_WRITE_MS } from "./constants.ts";
import { fireAndForget, logger } from "./logger.ts";
import { heartbeatIsFresh, missingWorkerMessage } from "./worker-heartbeat-policy.ts";

export async function touchWorkerHeartbeat(): Promise<void> {
  const workerId = workerInstanceId();
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { workerId },
    create: { workerId, lastTickAt: now },
    update: { lastTickAt: now },
  });
}

export type WorkerHeartbeatStatus = {
  queueEnabled: boolean;
  hasRecentHeartbeat: boolean;
  lastTickAt: string | null;
  staleAfterMs: number;
};

export async function getWorkerHeartbeatStatus(): Promise<WorkerHeartbeatStatus> {
  const queueEnabled = isDbAuditQueueEnabled();
  if (!queueEnabled) {
    return {
      queueEnabled,
      hasRecentHeartbeat: true,
      lastTickAt: null,
      staleAfterMs: WORKER_HEARTBEAT_STALE_MS,
    };
  }
  const cutoff = new Date(Date.now() - WORKER_HEARTBEAT_STALE_MS);
  const latest = await prisma.workerHeartbeat.findFirst({
    where: { lastTickAt: { gte: cutoff } },
    orderBy: { lastTickAt: "desc" },
    select: { lastTickAt: true },
  });
  return {
    queueEnabled,
    hasRecentHeartbeat: heartbeatIsFresh(latest?.lastTickAt),
    lastTickAt: latest?.lastTickAt.toISOString() ?? null,
    staleAfterMs: WORKER_HEARTBEAT_STALE_MS,
  };
}

export function warnIfNoWorkerOnBoot(): void {
  if (!isDbAuditQueueEnabled() || auditWorkerDrainEnabled()) return;
  fireAndForget(
    getWorkerHeartbeatStatus()
      .then((status) => {
        if (!status.hasRecentHeartbeat) {
          logger.warn(`[boot] ${missingWorkerMessage()}`);
        }
      })
      .catch((err) => {
        logger.error("[boot] Could not check audit worker heartbeat:", err);
      }),
    "worker heartbeat startup check",
  );
}

export function registerWorkerHeartbeat(): void {
  if (!auditWorkerDrainEnabled()) return;
  fireAndForget(touchWorkerHeartbeat(), "worker heartbeat write");
  const timer = setInterval(() => {
    fireAndForget(touchWorkerHeartbeat(), "worker heartbeat write");
  }, WORKER_HEARTBEAT_WRITE_MS);
  timer.unref();
}
