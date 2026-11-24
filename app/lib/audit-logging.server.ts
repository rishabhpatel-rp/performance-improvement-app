/** Structured audit events (audit-system-health-plan Phase 5). */

export type AuditLogEvent =
  | "audit_enqueue"
  | "audit_claim"
  | "audit_progress"
  | "audit_complete"
  | "audit_fail"
  | "audit_page_done"
  | "audit_drain_tick"
  | "audit_claim_skipped"
  | "audit_obs"
  | "storefront_runtime_errors";

export function logAuditEvent(event: AuditLogEvent, fields: Record<string, unknown>): void {
  const rssMb = Math.round(process.memoryUsage().rss / 1024 / 1024);
  console.log(JSON.stringify({ event, rssMb, ts: Date.now(), ...fields }));
}

export function logAuditPageDone(fields: {
  shop: string;
  path: string;
  pass: number;
  waitMs: number;
  scripts: number;
  emitted: number;
  foldOk: boolean;
}) {
  logAuditEvent("audit_page_done", fields);
}
