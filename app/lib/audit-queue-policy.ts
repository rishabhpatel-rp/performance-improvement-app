/** Pure admission rules for audit queue (AUDIT-SYSTEM-OCT-12 §9.3, D19). */

/** One running shop per app process by default (typical laptop / single dev server). */
export const MAX_CONCURRENT_AUDITS = Math.max(
  1,
  Number(process.env.AUDIT_MAX_CONCURRENT_SHOPS || "1"),
);

/** Keep in sync with `AUDIT_STALE_MS` in audit-lifecycle.ts (no import — node --test loads this file). */
export const STALE_RUNNING_MS =
  Math.max(5, Number(process.env.AUDIT_STALE_MINUTES || "15")) * 60 * 1000;

export type AdmissionDecision =
  | { allow: true }
  | { allow: false; code: "already_running" };

/** Whether this shop may add another queued/running job (one in-flight per store). */
export function decideAdmission(
  runningOrQueuedForShop: boolean,
): AdmissionDecision {
  if (runningOrQueuedForShop) {
    return { allow: false, code: "already_running" };
  }
  return { allow: true };
}

