import prisma from "../db.server";
import {
  AUDIT_STOPPED_BY_USER,
  auditProgressFlags,
  needsOrphanStaleClear,
  queuedJobStale,
} from "./audit-lifecycle";
export const AUDIT_SUPERSEDED_ERROR = "superseded by new audit start";

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
/** Fail queued/running jobs so a new audit can enqueue (re-run, OFF→ON toggle). */
export async function cancelLiveAuditJobsForStore(
  storeId: string,
  lastError: string = AUDIT_SUPERSEDED_ERROR,
): Promise<void> {
  await prisma.auditJob.updateMany({
    where: { storeId, status: { in: ["queued", "running"] } },
    data: {
      status: "failed",
      lockedAt: null,
      stopRequested: true,
      lastError,
    },
  });

  const superseded = lastError === AUDIT_SUPERSEDED_ERROR;
  await prisma.storeConfig.update({
    where: { storeId },
    data: {
      activeAuditJobId: null,
      ...(superseded
        ? {
            auditRunning: false,
            auditPhase: null,
            auditFailed: false,
            auditError: null,
          }
        : {}),
    },
  });
}

/**
 * Reconcile stale rows and abandon leftover queue jobs before a new run.
 */
export async function prepareStoreForNewAudit(
  shopDomain: string,
): Promise<{ storeId: string } | null> {
  await reconcileOrphanedStoreAuditState(shopDomain);

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      configs: {
        select: {
          auditRunning: true,
          auditComplete: true,
          auditFailed: true,
        },
        take: 1,
      },
    },
  });
  if (!store) return null;

  const sc = store.configs[0];
  if (sc && auditProgressFlags(sc).running && sc.auditComplete) {
    await prisma.storeConfig.update({
      where: { storeId: store.id },
      data: { auditRunning: false, auditPhase: null },
    });
  }

  await cancelLiveAuditJobsForStore(store.id);
  return { storeId: store.id };
}

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
          auditComplete: true,
          auditPageStartedAt: true,
          updatedAt: true,
          activeAuditJobId: true,
        },
        take: 1,
      },
    },
  });
  const sc = store?.configs?.[0];
  if (!store || !sc?.auditRunning) return;

  if (sc.auditComplete) {
    await prisma.storeConfig.update({
      where: { storeId: store.id },
      data: {
        auditRunning: false,
        auditPhase: null,
        activeAuditJobId: null,
      },
    });
    return;
  }

  const jobId = sc.activeAuditJobId;
  if (!jobId) {
    // A start sets auditRunning before the job id is written. Failing that
    // immediately made the dashboard kill a run that had just begun.
    if (
      !needsOrphanStaleClear({
        auditRunning: true,
        auditPageStartedAt: sc.auditPageStartedAt,
        updatedAt: sc.updatedAt,
        activeAuditJobId: null,
      })
    ) {
      return;
    }
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
