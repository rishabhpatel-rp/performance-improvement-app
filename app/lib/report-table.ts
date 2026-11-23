/** Pure helpers for the audit report table (UX-19). */

export const STATUS_LABELS: Record<string, string> = {
  deferred: "Deferred",
  protected: "Keep protected",
  candidate: "Candidate",
  never: "Never defer",
  noise: "Noise",
  self: "Our script",
};

export function severityLabel(status: string): string {
  return STATUS_LABELS[status] ?? "Review";
}

export function filterScriptRows<T extends { token?: string; domain?: string; status?: string }>(
  rows: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    [row.token, row.domain, row.status].some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(q),
    ),
  );
}

export function copyableValue(row: { token?: string; domain?: string }): string {
  return row.token || row.domain || "";
}
