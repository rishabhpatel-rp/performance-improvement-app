/** Pure audit run lifecycle rules (stale detection, user stop sentinel). */

export const AUDIT_STALE_MS = 15 * 60 * 1000;
/** Queued jobs may wait behind the global concurrency cap; keep this generous. */
export const QUEUED_JOB_STALE_MS = 3 * 60 * 60 * 1000;
export const AUDIT_STOPPED_BY_USER = "AUDIT_STOPPED_BY_USER";

export type StoreAuditRow = {
  auditRunning: boolean;
  auditPageStartedAt: Date | null;
  updatedAt: Date;
};

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
