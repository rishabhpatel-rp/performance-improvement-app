import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import {
  decideAdmission,
  MAX_CONCURRENT_AUDITS,
  STALE_RUNNING_MS,
} from "./audit-queue-policy";
import { QUEUED_JOB_STALE_MS } from "./audit-lifecycle";
import {
  reconcileStoreAfterJobEnd,
  setStoreActiveAuditJob,
  touchAuditJobHeartbeat,
} from "./audit-queue-reconcile.server";

const DRAIN_LOCK = { draining: false };

export async function enqueueAuditJob(
  shopDomain: string,
  storeId: string,
  payload: { enableOnCreate?: boolean } = {},
): Promise<{ enqueued: boolean; reason?: string; jobId?: string }> {
  await failStaleQueuedJobs();
  await failStaleRunningJobs();

  const activeForShop = await prisma.auditJob.count({
    where: {
      storeId,
      status: { in: ["queued", "running"] },
    },
  });
  const otherActive = await prisma.auditJob.count({
    where: {
      status: { in: ["queued", "running"] },
      storeId: { not: storeId },
    },
  });

  const admission = decideAdmission(activeForShop > 0, otherActive);
  if (!admission.allow) {
    return { enqueued: false, reason: admission.code };
  }

  try {
    const job = await prisma.auditJob.create({
      data: {
        storeId,
        shopDomain,
        status: "queued",
        payload,
      },
    });
    await setStoreActiveAuditJob(storeId, job.id);
    void drainAuditQueue();
    return { enqueued: true, jobId: job.id };
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
        lastError: "stale: no heartbeat within 15 minutes",
      },
    });
    await reconcileStoreAfterJobEnd(
      job.storeId,
      job.id,
      "failed",
      "stale: no heartbeat within 15 minutes",
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
    await prisma.auditJob.update({
      where: { id: job.id },
      data: { status: "succeeded", lockedAt: null },
    });
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
