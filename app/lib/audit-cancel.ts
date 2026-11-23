/** Shared cancellation/timeout errors so the queue, runner and page engine can
 *  stop an audit without importing each other. */

export class AuditRunCancelledError extends Error {
  constructor() {
    super("Audit run was cancelled.");
    this.name = "AuditRunCancelledError";
  }
}

export class AuditRunTimeoutError extends Error {
  constructor() {
    super("Audit run exceeded the configured deadline.");
    this.name = "AuditRunTimeoutError";
  }
}

export function auditAbortReason(
  signal?: AbortSignal,
  runDeadlineAt?: number,
  stopped?: () => boolean | Promise<boolean>,
): "cancelled" | "timeout" | null {
  if (signal?.aborted) return "cancelled";
  if (runDeadlineAt != null && Date.now() > runDeadlineAt) return "timeout";
  if (stopped?.()) return "cancelled";
  return null;
}
