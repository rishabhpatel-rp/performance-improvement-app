import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { MAX_CONCURRENT_AUDITS, STALE_RUNNING_MS } from "./audit-queue-policy";
import { QUEUED_JOB_STALE_MS } from "./audit-lifecycle";
import { AUDIT_SUPERSEDED_ERROR, reconcileStoreAfterJobEnd } from "./audit-queue-reconcile.server";
import {
  AUDIT_DRAIN_POLL_MS,
  AUDIT_MAX_QUEUE_DEPTH,
  AUDIT_SHOP_COOLDOWN_MS,
  auditMemoryHighWatermark,
  auditWorkerDrainEnabled,
  workerInstanceId,
} from "./audit-env.server";
import { retryBackoffMs } from "./audit-error-codes.server";
import { logAuditEvent } from "./audit-logging.server";
import { hostMemoryUseRatio, memoryAboveWatermark } from "./audit-host-memory.server";

import { logger } from "./logger.ts";
const DRAIN_LOCK = { draining: false };
let shuttingDown = false;
let drainTimer: ReturnType<typeof setInterval> | null = null;
let lastDrainTickAt: number | null = null;

export function getAuditDrainDiagnostics() {
  return {
    lastDrainTickAt,
    drainPollMs: AUDIT_DRAIN_POLL_MS,
    workerDrainEnabled: auditWorkerDrainEnabled(),
  };
}

export type EnqueuePayload = {
  enableOnCreate?: boolean;
  trigger?: string;
  priority?: number;
  force?: boolean;
};

async function shopInCooldown(storeId: string, force: boolean): Promise<boolean> {
  if (force || AUDIT_SHOP_COOLDOWN_MS <= 0) return false;
  const last = await prisma.auditJob.findFirst({
    where: { storeId, status: { in: ["succeeded", "running"] } },
    orderBy: { finishedAt: "desc" },
    select: { finishedAt: true, startedAt: true },
  });
  const ended = last?.finishedAt ?? last?.startedAt;
  if (!ended) return false;
  return Date.now() - ended.getTime() < AUDIT_SHOP_COOLDOWN_MS;
}

export async function enqueueAuditJob(
  shopDomain: string,
  storeId: string,
  payload: EnqueuePayload = {},
): Promise<{
  enqueued: boolean;
  reason?: string;
  jobId?: string;
  waiting?: boolean;
}> {
  await failStaleQueuedJobs();
  await failStaleRunningJobs();

  const queuedDepth = await prisma.auditJob.count({ where: { status: "queued" } });
  if (queuedDepth >= AUDIT_MAX_QUEUE_DEPTH) {
    return { enqueued: false, reason: "queue_full" };
  }

  if (await shopInCooldown(storeId, payload.force === true)) {
    return { enqueued: false, reason: "cooldown" };
  }

  const swapInQueuedJob = () =>
    prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.auditJob.updateMany({
        where: { storeId, status: { in: ["queued", "running"] } },
        data: {
          status: "failed",
          lockedAt: null,
          stopRequested: true,
          lastError: AUDIT_SUPERSEDED_ERROR,
        },
      });
      const created = await tx.auditJob.create({
        data: {
          storeId,
          shopDomain,
          status: "queued",
          priority: payload.priority ?? 0,
          trigger: payload.trigger ?? null,
          payload: payload as object,
        },
      });
      await tx.storeConfig.update({
        where: { storeId },
        data: { activeAuditJobId: created.id },
      });
      return created;
    });

  const finishEnqueue = async (job: { id: string }) => {
    const runningNow = await prisma.auditJob.count({
      where: { status: "running" },
    });
    logAuditEvent("audit_enqueue", {
      shop: shopDomain,
      jobId: job.id,
      queueDepth: queuedDepth + 1,
      running: runningNow,
      trigger: payload.trigger ?? null,
      priority: payload.priority ?? 0,
    });
    if (runningNow >= MAX_CONCURRENT_AUDITS) {
      await prisma.storeConfig.updateMany({
        where: { storeId, activeAuditJobId: job.id },
        data: { auditPhase: "queued" },
      });
    }
    if (auditWorkerDrainEnabled()) void drainAuditQueue();
    return {
      enqueued: true as const,
      jobId: job.id,
      waiting: runningNow >= MAX_CONCURRENT_AUDITS,
    };
  };

  try {
    const job = await swapInQueuedJob();
    return finishEnqueue(job);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { enqueued: false, reason: "already_running" };
    }
    throw err;
  }
}

async function failStaleQueuedJobs() {
  const cutoff = new Date(Date.now() - QUEUED_JOB_STALE_MS);
  const stale = await prisma.auditJob.findMany({
    where: { status: "queued", createdAt: { lt: cutoff } },
    select: { id: true, storeId: true },
  });
  for (const job of stale) {
    await prisma.auditJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lockedAt: null,
        lastError: "stale: queued too long without starting",
        errorCode: "QUEUE_TIMEOUT",
      },
    });
    await reconcileStoreAfterJobEnd(
      job.storeId,
      job.id,
      "failed",
      "stale: queued too long without starting",
    );
  }
}

async function failStaleRunningJobs() {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const stale = await prisma.auditJob.findMany({
    where: { status: "running", lockedAt: { lt: cutoff } },
    select: { id: true, storeId: true, attempts: true, maxAttempts: true },
  });
  for (const job of stale) {
    await prisma.auditJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lockedAt: null,
        lastError: `stale: no heartbeat within ${Math.round(STALE_RUNNING_MS / 60_000)} minutes`,
        errorCode: "STALE_RUNNING",
      },
    });
    await reconcileStoreAfterJobEnd(
      job.storeId,
      job.id,
      "failed",
      `stale: no heartbeat within ${Math.round(STALE_RUNNING_MS / 60_000)} minutes`,
    );
  }
}

export async function claimNextAuditJob(): Promise<{ id: string } | null> {
  const worker = workerInstanceId();
  const watermark = auditMemoryHighWatermark();
  if (memoryAboveWatermark(watermark)) {
    logAuditEvent("audit_claim_skipped", {
      reason: "memory_high",
      memoryUseRatio: hostMemoryUseRatio(),
      watermark,
    });
    return null;
  }
  return prisma
    .$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(89127421)`;
      const running = await tx.auditJob.count({ where: { status: "running" } });
      if (running >= MAX_CONCURRENT_AUDITS) return null;

      const candidates = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "AuditJob"
      WHERE status = 'queued'
        AND "stopRequested" = false
        AND "runAt" <= NOW()
      ORDER BY priority DESC, "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    `;
      if (!candidates.length) return null;

      const jobId = candidates[0].id;
      await tx.auditJob.update({
        where: { id: jobId },
        data: {
          status: "running",
          lockedAt: new Date(),
          startedAt: new Date(),
          workerId: worker,
          attempts: { increment: 1 },
        },
      });
      return { id: jobId };
    })
    .then((claimed: { id: string } | null) => {
      if (claimed) {
        logAuditEvent("audit_claim", {
          jobId: claimed.id,
          workerId: worker,
          memoryUseRatio: hostMemoryUseRatio(),
        });
      }
      return claimed;
    });
}

export async function drainAuditQueue(): Promise<void> {
  if (shuttingDown || !auditWorkerDrainEnabled()) return;
  if (DRAIN_LOCK.draining) return;
  DRAIN_LOCK.draining = true;
  try {
    for (;;) {
      const job = await claimNextAuditJob();
      if (!job) break;
      void runClaimedJob(job.id);
      const running = await prisma.auditJob.count({ where: { status: "running" } });
      if (running >= MAX_CONCURRENT_AUDITS) break;
    }
  } finally {
    DRAIN_LOCK.draining = false;
  }
}

async function runClaimedJob(jobId: string) {
  const { runAuditJob } = await import("./audit-job-worker.server");
  try {
    await runAuditJob(jobId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const job = await prisma.auditJob.findUnique({ where: { id: jobId } });
    if (!job) return;
    await prisma.auditJob.update({
      where: { id: jobId },
      data: { status: "failed", lastError: msg, lockedAt: null, errorCode: "UNKNOWN" },
    });
    await reconcileStoreAfterJobEnd(job.storeId, jobId, "failed", msg);
  } finally {
    void drainAuditQueue();
  }
}

/** Requeue jobs orphaned by a dead worker (other workerId or stale heartbeat). */
export async function recoverAuditJobsOnBoot(): Promise<void> {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MS);
  const worker = workerInstanceId();

  const orphans = await prisma.auditJob.findMany({
    where: {
      status: "running",
      OR: [{ lockedAt: { lt: staleBefore } }, { workerId: { not: worker } }, { workerId: null }],
    },
    select: { id: true, storeId: true, attempts: true, maxAttempts: true },
  });

  for (const job of orphans) {
    if (job.attempts < job.maxAttempts) {
      await prisma.auditJob.update({
        where: { id: job.id },
        data: {
          status: "queued",
          workerId: null,
          lockedAt: null,
          runAt: new Date(Date.now() + retryBackoffMs(job.attempts)),
          lastError: "requeued after worker restart",
        },
      });
      await prisma.storeConfig.update({
        where: { storeId: job.storeId },
        data: { auditPhase: "queued", auditRunning: true },
      });
    } else {
      await prisma.auditJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          errorCode: "WORKER_LOST",
          lastError: "worker restarted; max attempts reached",
          lockedAt: null,
        },
      });
      await reconcileStoreAfterJobEnd(
        job.storeId,
        job.id,
        "failed",
        "worker restarted; max attempts reached",
      );
    }
  }
}

export function registerAuditQueueDrain(): void {
  if (!auditWorkerDrainEnabled()) return;
  if (drainTimer) return;
  lastDrainTickAt = Date.now();
  void recoverAuditJobsOnBoot().then(() => drainAuditQueue());
  drainTimer = setInterval(() => {
    lastDrainTickAt = Date.now();
    logAuditEvent("audit_drain_tick", { workerId: workerInstanceId() });
    void drainAuditQueue();
  }, AUDIT_DRAIN_POLL_MS);
  drainTimer.unref();
}

/** If no separate worker is alive, let this web process drain the queue so
 *  `shopify app dev` works without starting a second process. */
export async function maybeStartWebFallbackDrain(): Promise<void> {
  const { getEnv } = await import("./env.server.ts");
  const { isDbAuditQueueEnabled, auditWorkerDrainEnabled, enableLocalDrain } =
    await import("./audit-env.server.ts");
  if (!isDbAuditQueueEnabled() || auditWorkerDrainEnabled()) return;
  if (getEnv().AUDIT_WORKER_ENABLED === "true") return;
  const { getWorkerHeartbeatStatus, registerWorkerHeartbeat } =
    await import("./worker-heartbeat.server.ts");
  const status = await getWorkerHeartbeatStatus().catch(() => ({ hasRecentHeartbeat: true }));
  if (status.hasRecentHeartbeat) return;
  enableLocalDrain();
  logger.warn("[audit-queue] no worker heartbeat detected; this web process will drain the queue");
  registerAuditQueueDrain();
  registerWorkerHeartbeat();
}

/** SIGTERM: stop claiming, let in-flight audits finish, close Chromium, exit. */
export function registerAuditQueueShutdown() {
  process.once("SIGTERM", () => {
    if (drainTimer) clearInterval(drainTimer);
    drainTimer = null;
    shuttingDown = true;
    logger.info("[audit-queue] SIGTERM — no new claims; waiting for in-flight audits");
    const deadline = Date.now() + 110_000;
    const check = async () => {
      try {
        const running = await prisma.auditJob.count({ where: { status: "running" } });
        if (running > 0 && Date.now() < deadline) {
          setTimeout(() => void check(), 1000);
          return;
        }
        if (running > 0) {
          await prisma.auditJob.updateMany({
            where: { status: "running" },
            data: { status: "queued", lockedAt: null, workerId: null },
          });
          logger.warn("[audit-queue] SIGTERM deadline: released running jobs to the queue");
        }
      } catch (err) {
        logger.error("[audit-queue] SIGTERM cleanup failed:", err);
      }
      const { closeIdleBrowser } = await import("./audit-browser.ts");
      await closeIdleBrowser();
      logger.info("[audit-queue] worker shutdown complete");
      process.exit(0);
    };
    void check();
  });
}
