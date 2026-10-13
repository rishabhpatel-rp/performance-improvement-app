/** Pure admission rules for audit queue (AUDIT-SYSTEM-OCT-12 §9.3, D19). */

export const MAX_CONCURRENT_AUDITS = Number(
  process.env.AUDIT_MAX_CONCURRENT_SHOPS || "3",
);

export type AdmissionDecision =
  | { allow: true }
  | { allow: false; code: "already_running" | "busy" };

export function decideAdmission(
  runningOrQueuedForShop: boolean,
  otherShopsActive: number,
): AdmissionDecision {
  if (runningOrQueuedForShop) {
    return { allow: false, code: "already_running" };
  }
  if (otherShopsActive >= MAX_CONCURRENT_AUDITS) {
    return { allow: false, code: "busy" };
  }
  return { allow: true };
}

export const STALE_RUNNING_MS = 15 * 60 * 1000;
