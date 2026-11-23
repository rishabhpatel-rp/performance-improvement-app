/** CSV export for the admin store table. Quotes fields and escapes embedded
 *  quotes/newlines so the file opens correctly in spreadsheets. */

function csvCell(value: unknown): string {
  if (value == null) return "";
  const text = value instanceof Date ? value.toISOString() : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function storeRowsToCsv(
  rows: Array<Record<string, unknown>>,
  columns: Array<{ key: string; label: string }>,
): string {
  const header = columns.map((c) => csvCell(c.label)).join(",");
  const lines = rows.map((row) => columns.map((c) => csvCell(row[c.key])).join(","));
  return [header, ...lines].join("\r\n");
}
