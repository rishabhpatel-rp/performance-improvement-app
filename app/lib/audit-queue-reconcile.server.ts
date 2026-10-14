import prisma from "../db.server";
import { AUDIT_STOPPED_BY_USER, queuedJobStale } from "./audit-lifecycle";

/** Keeps a claimed job from being marked stale while the worker is alive. */
export async function touchAuditJobHeartbeat(jobId: string): Promise<void> {
  await prisma.auditJob.updateMany({
    where: { id: jobId, status: "running" },
    data: { lockedAt: new Date() },
  });
}

export async function setStoreActiveAuditJob(
  storeId: string,
  jobId: string,
): Promise<void> {
  await prisma.storeConfig.update({
    where: { storeId },
    data: { activeAuditJobId: jobId },
  });
}

/** Clear stuck audit UI when the job row is no longer active. */
export async function reconcileOrphanedStoreAuditState(
  shopDomain: string,
): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      configs: {
        select: {
          auditRunning: true,
          activeAuditJobId: true,
        },
        take: 1,
      },
    },
  });
  const sc = store?.configs?.[0];
  if (!store || !sc?.auditRunning) return;

  const jobId = sc.activeAuditJobId;
  if (!jobId) {
    await prisma.storeConfig.update({
      where: { storeId: store.id },
      data: {
        auditRunning: false,
        auditPhase: null,
        auditFailed: true,
        auditError: "orphaned: no active job",
        activeAuditJobId: null,
      },
    });
    return;
  }

  const job = await prisma.auditJob.findUnique({
    where: { id: jobId },
    select: { status: true, lastError: true, createdAt: true },
  });
  if (
    job?.status === "queued" &&
    job.createdAt &&
    queuedJobStale(job.createdAt)
  ) {
    await prisma.auditJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        lockedAt: null,
        lastError: "stale: queued too long without starting",
      },
    });
    await reconcileStoreAfterJobEnd(
      store.id,
      jobId,
      "failed",
      "stale: queued too long without starting",
    );
    return;
  }
  if (!job || job.status === "queued" || job.status === "running") return;

  await prisma.storeConfig.update({
    where: { storeId: store.id },
    data: {
      auditRunning: false,
      auditPhase: null,
      activeAuditJobId: null,
      auditFailed: job.status === "failed",
      auditError:
        job.status === "failed"
          ? job.lastError || "audit job failed"
          : null,
      auditComplete: job.status === "succeeded",
    },
  });
}

export async function reconcileStoreAfterJobEnd(
  storeId: string,
  jobId: string,
  outcome: "succeeded" | "failed",
  lastError?: string,
): Promise<void> {
  const sc = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { activeAuditJobId: true },
  });
  if (sc?.activeAuditJobId !== jobId) return;

  if (outcome === "failed") {
    const stoppedByUser = lastError === AUDIT_STOPPED_BY_USER;
    await prisma.storeConfig.update({
      where: { storeId },
      data: {
        activeAuditJobId: null,
        auditRunning: false,
        auditPhase: null,
        auditFailed: stoppedByUser ? false : true,
        auditError: stoppedByUser ? null : lastError || "audit job failed",
        auditComplete: false,
      },
    });
  } else {
    await prisma.storeConfig.update({
      where: { storeId },
      data: { activeAuditJobId: null },
    });
  }
}
