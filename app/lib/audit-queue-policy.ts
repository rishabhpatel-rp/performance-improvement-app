import { getEnv } from "./env.server.ts";
/** Pure admission rules for audit queue (AUDIT-SYSTEM-OCT-12 §9.3, D19). */

/** Up to four shops can be audited in parallel; beyond that jobs wait in the queue. */
export const MAX_CONCURRENT_AUDITS = Math.max(1, getEnv().AUDIT_MAX_CONCURRENT_SHOPS);

/** Keep in sync with `AUDIT_STALE_MS` in audit-lifecycle.ts (no import — node --test loads this file). */
export const STALE_RUNNING_MS = Math.max(5, getEnv().AUDIT_STALE_MINUTES) * 60 * 1000;

export type AdmissionDecision = { allow: true } | { allow: false; code: "already_running" };

/** Whether this shop may add another queued/running job (one in-flight per store). */
export function decideAdmission(runningOrQueuedForShop: boolean): AdmissionDecision {
  if (runningOrQueuedForShop) {
    return { allow: false, code: "already_running" };
  }
  return { allow: true };
}
