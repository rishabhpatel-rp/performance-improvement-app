import prisma from "../db.server";
import { Prisma } from "@prisma/client";
import { decideAdmission, STALE_RUNNING_MS } from "./audit-queue-policy";
import { unauthenticated } from "../shopify.server";

const DRAIN_LOCK = { draining: false };

export async function enqueueAuditJob(
  shopDomain: string,
  storeId: string,
  payload: { enableOnCreate?: boolean } = {},
): Promise<{ enqueued: boolean; reason?: string }> {
  await requeueStaleRunningJobs();

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
    await prisma.auditJob.create({
      data: {
        storeId,
        shopDomain,
        status: "queued",
        payload,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return { enqueued: false, reason: "already_running" };
    }
    throw err;
  }

  void drainAuditQueue();
  return { enqueued: true };
}

async function requeueStaleRunningJobs() {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  await prisma.auditJob.updateMany({
    where: { status: "running", lockedAt: { lt: cutoff } },
    data: {
      status: "queued",
      lockedAt: null,
      lastError: "requeued: stale running",
    },
  });
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
      if (otherRunning >= Number(process.env.AUDIT_MAX_CONCURRENT_SHOPS || "3")) {
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
  shopDomain: string;
  payload: unknown;
}) {
  try {
    const { executeAuditJob } = await import("./audit-runner.server");
    const { admin } = await unauthenticated.admin(job.shopDomain);
    const payload = (job.payload || {}) as { enableOnCreate?: boolean };
    await executeAuditJob(admin, job.shopDomain, {
      enableOnCreate: payload.enableOnCreate ?? false,
    });
    await prisma.auditJob.update({
      where: { id: job.id },
      data: { status: "succeeded", lockedAt: null },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await prisma.auditJob.update({
      where: { id: job.id },
      data: { status: "failed", lockedAt: null, lastError: msg },
    });
  } finally {
    void drainAuditQueue();
  }
}

/** SIGTERM: stop claiming new jobs; in-flight audits finish via runner generation. */
export function registerAuditQueueShutdown() {
  process.once("SIGTERM", () => {
    console.log("[audit-queue] SIGTERM — no new claims until process exit");
  });
}
