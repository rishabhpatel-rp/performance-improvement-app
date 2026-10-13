/** Structured audit progress (AUDIT-SYSTEM-OCT-12 §11.3). */

export function logAuditPageDone(fields: {
  shop: string;
  path: string;
  pass: number;
  waitMs: number;
  scripts: number;
  emitted: number;
  foldOk: boolean;
}) {
  console.log(
    JSON.stringify({
      event: "audit_page_done",
      ...fields,
    }),
  );
}
