import { getEnv } from "./env.server.ts";
/** Audit queue / worker feature flags and limits (audit-system-health-plan §8). */

export function isDbAuditQueueEnabled(): boolean {
  return getEnv().AUDIT_USE_DB_QUEUE;
}

let localDrainEnabled = false;

/** Web-process fallback when no separate worker is running. */
export function enableLocalDrain(): void {
  localDrainEnabled = true;
}

export function auditWorkerDrainEnabled(): boolean {
  if (localDrainEnabled) return true;
  if (getEnv().AUDIT_WORKER_ENABLED === "false") return false;
  if (getEnv().AUDIT_WORKER_ENABLED === "true") return true;
  return isDbAuditQueueEnabled();
}

export function workerInstanceId(): string {
  const explicit = getEnv().AUDIT_WORKER_ID.trim();
  if (explicit) return explicit;
  return `w-${process.pid}-${getEnv().HOSTNAME}`;
}

export const AUDIT_MAX_QUEUE_DEPTH = Math.max(1, getEnv().AUDIT_MAX_QUEUE_DEPTH);

export const AUDIT_SHOP_COOLDOWN_MS = Math.max(0, getEnv().AUDIT_SHOP_COOLDOWN_MINUTES) * 60 * 1000;

export const AUDIT_DRAIN_POLL_MS = Math.max(2000, getEnv().AUDIT_DRAIN_POLL_MS);

export const AUDIT_MAX_ATTEMPTS = Math.max(1, getEnv().AUDIT_MAX_ATTEMPTS);

export function auditRunDeadlineMs(): number {
  return Math.max(5, getEnv().AUDIT_RUN_DEADLINE_MINUTES) * 60 * 1000;
}

/** Returns null when pre-claim memory guard is disabled (`AUDIT_MEMORY_HIGH_WATERMARK=off`). */
export function auditMemoryHighWatermark(): number | null {
  const raw = getEnv().AUDIT_MEMORY_HIGH_WATERMARK.trim().toLowerCase();
  if (raw === "off" || raw === "0" || raw === "false") return null;
  const value = Number(raw ?? "0.75");
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.min(1, Math.max(0.1, value));
}
