import type { ScriptInventoryEntry } from "./audit-report-types";

export type AuditRiskLabel = "low" | "medium" | "high";

export function classifyRiskLabel(entry: ScriptInventoryEntry): AuditRiskLabel {
  if (entry.status === "never" || entry.status === "protected") return "low";
  if (entry.status === "deferred" && (entry.homeRequestOrder ?? 999) <= 8) return "high";
  if (entry.status === "deferred" && (entry.homeStartMs ?? 9999) < 1000) return "high";
  if (entry.status === "deferred") return "medium";
  return "low";
}
