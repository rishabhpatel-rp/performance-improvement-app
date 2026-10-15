import prisma from "../db.server";
import {
  AUDIT_STOPPED_BY_USER,
  AUDIT_STALE_MS,
  staleReason,
  queuedJobStale,
  needsOrphanStaleClear,
  type StoreAuditRow,
} from "./audit-lifecycle";
import { reconcileStoreAfterJobEnd } from "./audit-queue-reconcile.server";
import { drainAuditQueue } from "./audit-queue.server";

let watchdogStarted = false;

const STALE_SWEEP_THROTTLE_MS = 15_000;
const lastSweepAtByShop = new Map<string, number>();

function runningJobHasFreshHeartbeat(lockedAt: Date | null, nowMs = Date.now()): boolean {
  if (!lockedAt) return false;
  return nowMs - lockedAt.getTime() <= AUDIT_STALE_MS;
}

async function clearOrphanStaleRunningStore(
  storeId: string,
  error = "stale: no progress within 15 minutes",
): Promise<void> {
  await prisma.storeConfig.update({
    where: { storeId },
    data: {
      auditRunning: false,
      auditPhase: null,
      auditFailed: true,
      auditError: error,
      activeAuditJobId: null,
    },
  });
}

async function loadStoreAuditRow(shopDomain: string): Promise<{
  storeId: string;
  sc: StoreAuditRow & { activeAuditJobId: string | null };
} | null> {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      configs: {
        select: {
          auditRunning: true,
          auditPageStartedAt: true,
          updatedAt: true,
          activeAuditJobId: true,
        },
        take: 1,
      },
    },
  });
  if (!store) return null;
  const sc = store.configs[0];
  if (!sc) return null;
  return { storeId: store.id, sc };
}

/**
 * Fail long-queued jobs and clear stuck `auditRunning` for one shop.
 * @returns true when a job or store row was updated (queue drain may be needed).
 */
export async function sweepStaleAuditStateForShop(
  shopDomain: string,
): Promise<boolean> {
  const loaded = await loadStoreAuditRow(shopDomain);
  if (!loaded) return false;
  const { sc } = loaded;
  let changed = false;

  const jobId = sc.activeAuditJobId;
  if (jobId) {
    const job = await prisma.auditJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        storeId: true,
        status: true,
        createdAt: true,
        lockedAt: true,
      },
    });
    if (job?.status === "queued" && queuedJobStale(job.createdAt)) {
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
      changed = true;
    }
  }

  const latest = await loadStoreAuditRow(shopDomain);
  if (!latest?.sc.auditRunning) {
    return changed;
  }

  const staleMsg = `stale: no progress within ${Math.round(AUDIT_STALE_MS / 60_000)} minutes`;

  const activeJobId = latest.sc.activeAuditJobId;
  if (activeJobId) {
    const job = await prisma.auditJob.findUnique({
      where: { id: activeJobId },
      select: {
        id: true,
        storeId: true,
        status: true,
        lockedAt: true,
        createdAt: true,
      },
    });
    // Waiting behind the global concurrency cap — not "stuck" until QUEUED_JOB_STALE_MS.
    if (job?.status === "queued") {
      return changed;
    }
    if (
      job?.status === "running" &&
      runningJobHasFreshHeartbeat(job.lockedAt)
    ) {
      return changed;
    }
    if (job?.status === "running") {
      await prisma.auditJob.update({
        where: { id: job.id },
        data: {
          status: "failed",
          lockedAt: null,
          lastError: staleMsg,
        },
      });
      await reconcileStoreAfterJobEnd(job.storeId, job.id, "failed", staleMsg);
      return true;
    }
  }

  if (!staleReason(latest.sc)) {
    return changed;
  }

  const afterJob = await loadStoreAuditRow(shopDomain);
  if (afterJob && needsOrphanStaleClear(afterJob.sc)) {
    await clearOrphanStaleRunningStore(afterJob.storeId, staleMsg);
    return true;
  }

  return changed;
}

/** Throttled sweep for hot paths (loader, status poll, audit start). */
export async function maybeSweepStaleAuditStateForShop(
  shopDomain: string,
  options: { force?: boolean } = {},
): Promise<void> {
  const now = Date.now();
  if (!options.force) {
    const last = lastSweepAtByShop.get(shopDomain) ?? 0;
    if (now - last < STALE_SWEEP_THROTTLE_MS) return;
  }
  lastSweepAtByShop.set(shopDomain, now);
  const changed = await sweepStaleAuditStateForShop(shopDomain).catch((err) => {
    console.warn(
      "[audit-watchdog] sweep failed:",
      err instanceof Error ? err.message : err,
    );
    return false;
  });
  if (changed) void drainAuditQueue();
}

async function sweepStaleAuditStateBatch(limit = 25): Promise<void> {
  const rows = await prisma.storeConfig.findMany({
    where: { auditRunning: true },
    select: {
      store: { select: { shopDomain: true } },
    },
    take: limit,
  });
  let anyChanged = false;
  for (const row of rows) {
    const domain = row.store?.shopDomain;
    if (domain) {
      const changed = await sweepStaleAuditStateForShop(domain).catch((err) => {
        console.warn(
          "[audit-watchdog] sweep failed:",
          err instanceof Error ? err.message : err,
        );
        return false;
      });
      if (changed) anyChanged = true;
    }
  }
  if (anyChanged) void drainAuditQueue();
}

/** Lazy 60s timer; `.unref()` so it does not keep the process alive alone. */
export function registerAuditWatchdog(): void {
  if (watchdogStarted) return;
  watchdogStarted = true;
  const timer = setInterval(() => {
    void sweepStaleAuditStateBatch();
  }, 60_000);
  timer.unref();
}

export async function stopAuditForShop(shopDomain: string): Promise<{
  ok: boolean;
  error?: string;
}> {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      configs: {
        select: { auditRunning: true, activeAuditJobId: true },
        take: 1,
      },
    },
  });
  if (!store) return { ok: false, error: "Store record not found." };
  const sc = store.configs[0];
  if (!sc?.auditRunning) {
    return { ok: true };
  }

  const jobId = sc.activeAuditJobId;
  if (jobId) {
    await prisma.auditJob.updateMany({
      where: {
        id: jobId,
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "failed",
        lockedAt: null,
        stopRequested: true,
        lastError: AUDIT_STOPPED_BY_USER,
      },
    });
  }

  await prisma.storeConfig.update({
    where: { storeId: store.id },
    data: {
      auditRunning: false,
      auditPhase: null,
      auditFailed: false,
      auditError: null,
      activeAuditJobId: null,
    },
  });

  void drainAuditQueue();
  return { ok: true };
}
