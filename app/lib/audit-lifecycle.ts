/** Pure audit run lifecycle rules (stale detection, user stop sentinel). */

/** Wall-clock cap for a stuck run (override: `AUDIT_STALE_MINUTES`, default 15). */
export const AUDIT_STALE_MS =
  Math.max(5, Number(process.env.AUDIT_STALE_MINUTES || "15")) * 60 * 1000;

/** Worker touches `AuditJob.lockedAt` this often during long page work. */
export const AUDIT_HEARTBEAT_INTERVAL_MS = 2 * 60 * 1000;
/** Queued jobs may wait behind the global concurrency cap; keep this generous. */
export const QUEUED_JOB_STALE_MS = 3 * 60 * 60 * 1000;
export const AUDIT_STOPPED_BY_USER = "AUDIT_STOPPED_BY_USER";

export type StoreAuditRow = {
  auditRunning: boolean;
  auditPageStartedAt: Date | null;
  updatedAt: Date;
};

export type StoreAuditFlagsRow = {
  auditRunning?: boolean;
  auditComplete?: boolean;
  auditFailed?: boolean;
};

/** Client/API "in progress" — DB can briefly have running+complete after a failed reconcile. */
export function auditProgressFlags(sc: StoreAuditFlagsRow | null | undefined) {
  const complete = sc?.auditComplete === true;
  const failed = sc?.auditFailed === true;
  const running = Boolean(sc?.auditRunning && !complete && !failed);
  return { running, complete, failed };
}

export function lastSignOfLife(row: StoreAuditRow): number {
  const t = row.auditPageStartedAt ?? row.updatedAt;
  return t.getTime();
}

/** Why a store row should be swept while `auditRunning` is still true. */
export function staleReason(
  row: StoreAuditRow,
  nowMs = Date.now(),
): "stale_running" | null {
  if (!row.auditRunning) return null;
  if (nowMs - lastSignOfLife(row) > AUDIT_STALE_MS) {
    return "stale_running";
  }
  return null;
}

export function queuedJobStale(
  createdAt: Date,
  nowMs = Date.now(),
): boolean {
  return nowMs - createdAt.getTime() > QUEUED_JOB_STALE_MS;
}

export function planStaleSweep(
  rows: StoreAuditRow[],
  nowMs = Date.now(),
): number[] {
  const stale: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    if (staleReason(rows[i], nowMs)) stale.push(i);
  }
  return stale;
}

/** Store still marked running with no job pointer — safe to clear as orphan stale. */
export function needsOrphanStaleClear(
  row: StoreAuditRow & { activeAuditJobId?: string | null },
  nowMs = Date.now(),
): boolean {
  if (!row.auditRunning || row.activeAuditJobId) return false;
  return staleReason(row, nowMs) === "stale_running";
}
