/**
 * Per-shop audit run generation + cooperative cancellation.
 * `stopAuditForShop` and superseding starts bump generation and abort in-flight work.
 */

const auditRunGenerations = new Map<string, number>();
const abortControllers = new Map<string, AbortController>();

export function beginAuditRun(shopDomain: string): {
  generation: number;
  signal: AbortSignal;
} {
  const generation = (auditRunGenerations.get(shopDomain) ?? 0) + 1;
  auditRunGenerations.set(shopDomain, generation);
  const ac = new AbortController();
  abortControllers.set(shopDomain, ac);
  return { generation, signal: ac.signal };
}

export function isAuditRunCurrent(shopDomain: string, generation: number): boolean {
  return auditRunGenerations.get(shopDomain) === generation;
}

export function endAuditRun(shopDomain: string, generation: number): void {
  if (auditRunGenerations.get(shopDomain) !== generation) return;
  auditRunGenerations.delete(shopDomain);
  abortControllers.delete(shopDomain);
}

/** Stop, supersede, or app-off: invalidate the in-memory run immediately. */
export function supersedeAuditRun(shopDomain: string): void {
  const next = (auditRunGenerations.get(shopDomain) ?? 0) + 1;
  auditRunGenerations.set(shopDomain, next);
  abortControllers.get(shopDomain)?.abort();
  abortControllers.delete(shopDomain);
}
