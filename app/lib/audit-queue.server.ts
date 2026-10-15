import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { MAX_CONCURRENT_AUDITS, STALE_RUNNING_MS } from "./audit-queue-policy";
import { QUEUED_JOB_STALE_MS } from "./audit-lifecycle";
import {
  AUDIT_SUPERSEDED_ERROR,
  reconcileStoreAfterJobEnd,
  touchAuditJobHeartbeat,
} from "./audit-queue-reconcile.server";

const DRAIN_LOCK = { draining: false };

export async function enqueueAuditJob(
  shopDomain: string,
  storeId: string,
  payload: { enableOnCreate?: boolean } = {},
): Promise<{
  enqueued: boolean;
  reason?: string;
  jobId?: string;
  waiting?: boolean;
}> {
  await failStaleQueuedJobs();
  await failStaleRunningJobs();

  // Fail the previous job and point the store at the new one in one
  // transaction. Clearing auditRunning here (or leaving a gap with no job id)
  // made the dashboard drop a live run.
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
          payload,
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
    if (runningNow >= MAX_CONCURRENT_AUDITS) {
      await prisma.storeConfig.updateMany({
        where: { storeId, activeAuditJobId: job.id },
        data: { auditPhase: "queued" },
      });
    }
    void drainAuditQueue();
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
      try {
        const job = await swapInQueuedJob();
        return finishEnqueue(job);
      } catch (retryErr) {
        if (
          retryErr instanceof Prisma.PrismaClientKnownRequestError &&
          retryErr.code === "P2002"
        ) {
          return { enqueued: false, reason: "already_running" };
        }
        throw retryErr;
      }
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
    select: { id: true, storeId: true },
  });
  for (const job of stale) {
    await prisma.auditJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        lockedAt: null,
        lastError: `stale: no heartbeat within ${Math.round(STALE_RUNNING_MS / 60_000)} minutes`,
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

export async function claimNextAuditJob() {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "AuditJob"
    SET status = 'running',
        "lockedAt" = NOW(),
        attempts = attempts + 1,
        "updatedAt" = NOW()
    WHERE id = (
      SELECT id FROM "AuditJob"
      WHERE status = 'queued'
        AND "stopRequested" = false
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `;
  if (!rows.length) return null;
  return prisma.auditJob.findUnique({ where: { id: rows[0].id } });
}

export async function drainAuditQueue(): Promise<void> {
  if (DRAIN_LOCK.draining) return;
  DRAIN_LOCK.draining = true;
  try {
    for (;;) {
      const otherRunning = await prisma.auditJob.count({
        where: { status: "running" },
      });
      if (otherRunning >= MAX_CONCURRENT_AUDITS) {
        break;
      }
      const job = await claimNextAuditJob();
      if (!job) break;
      void runClaimedJob(job);
    }
  } finally {
    DRAIN_LOCK.draining = false;
  }
}

async function runClaimedJob(job: {
  id: string;
  storeId: string;
  shopDomain: string;
  payload: unknown;
}) {
  try {
    const { executeAuditJob } = await import("./audit-runner.server");
    const { unauthenticated } = await import("../shopify.server");
    const { admin } = await unauthenticated.admin(job.shopDomain);
    await touchAuditJobHeartbeat(job.id);
    await executeAuditJob(admin, job.shopDomain, { jobId: job.id });
    // A stop or a newer run already marked this row failed. Writing
    // "succeeded" here brought a cancelled audit back and cleared the live one.
    const marked = await prisma.auditJob.updateMany({
      where: { id: job.id, status: "running", stopRequested: false },
      data: { status: "succeeded", lockedAt: null },
    });
    if (marked.count === 0) return;
    await reconcileStoreAfterJobEnd(job.storeId, job.id, "succeeded");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.auditJob.update({
      where: { id: job.id },
      data: { status: "failed", lockedAt: null, lastError: msg },
    });
    await reconcileStoreAfterJobEnd(job.storeId, job.id, "failed", msg);
  } finally {
    void drainAuditQueue();
  }
}

/** SIGTERM: stop claiming new jobs; in-flight audits finish via runner. */
export function registerAuditQueueShutdown() {
  process.once("SIGTERM", () => {
    console.log("[audit-queue] SIGTERM — no new claims until process exit");
  });
}
