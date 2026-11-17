"use client";

import { useMemo, useState } from "react";
import {
  scriptListStateForScope,
  scriptListStateForTab,
} from "@/lib/audit-script-list-state";
import {
  scriptsForScope,
  tabDropdownAction,
  type ScriptRow,
} from "@/lib/scan-summary-scope";
import type { TemplateScope } from "@/lib/storefront-lists";

const SCRIPT_ACTION_OPTIONS = [
  { value: "defer", label: "Defer until interaction" },
  { value: "delay_first", label: "Delay (first user)" },
  { value: "delay_every", label: "Delay (every visit)" },
  { value: "protected", label: "Keep protected" },
] as const;

const SCRIPT_TABLE_COLUMNS = [
  { id: "name", label: "Name" },
  { id: "domain", label: "Domain" },
  { id: "type", label: "Type" },
  { id: "req", label: "Req #" },
  { id: "timeline", label: "Timeline" },
  { id: "size", label: "Size" },
  { id: "time", label: "Time" },
  { id: "status", label: "Status" },
  { id: "action", label: "Action" },
] as const;

function formatScriptSize(row: ScriptRow) {
  const bytes = (row.bytes ?? 0) > 0 ? row.bytes! : (row.kb ?? 0) > 0 ? row.kb! * 1024 : 0;
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb >= 100 ? `${Math.round(kb)} kB` : `${kb.toFixed(1)} kB`;
}

function scriptActionSelectValue(
  row: ScriptRow,
  lists: ReturnType<typeof scriptListStateForTab>,
) {
  return tabDropdownAction(
    {
      auditDeferArray: lists.auditDeferArray,
      firstUserDelayScripts: lists.firstUserDelayScripts,
      staticDeferDefaults: lists.staticDeferDefaults,
    },
    row.token,
  );
}

function compareScriptRows(
  a: ScriptRow,
  b: ScriptRow,
  colId: string,
  lists: ReturnType<typeof scriptListStateForTab>,
) {
  const str = (v: unknown) => String(v ?? "").toLowerCase();
  const num = (v: unknown) =>
    v == null || Number.isNaN(Number(v)) ? null : Number(v);
  let va: string | number | null;
  let vb: string | number | null;
  switch (colId) {
    case "name":
      va = str(a.token);
      vb = str(b.token);
      break;
    case "domain":
      va = str(a.domain);
      vb = str(b.domain);
      break;
    case "type":
      va = "script";
      vb = "script";
      break;
    case "req":
      va = num(a.homeRequestOrder);
      vb = num(b.homeRequestOrder);
      break;
    case "timeline":
      va = num(a.homeStartMs);
      vb = num(b.homeStartMs);
      break;
    case "size":
      va = num((a.bytes ?? 0) > 0 ? a.bytes : a.kb);
      vb = num((b.bytes ?? 0) > 0 ? b.bytes : b.kb);
      break;
    case "time":
      va = num(a.durationMs);
      vb = num(b.durationMs);
      break;
    case "status":
      va = str(a.status);
      vb = str(b.status);
      break;
    case "action":
      va = str(scriptActionSelectValue(a, lists));
      vb = str(scriptActionSelectValue(b, lists));
      break;
    default:
      va = 0;
      vb = 0;
  }
  if (va === vb) return 0;
  if (va == null) return 1;
  if (vb == null) return -1;
  if (typeof va === "number" && typeof vb === "number") return va - vb;
  return va < vb ? -1 : 1;
}

export type AuditSummaryPayload = {
  completedAt?: string;
  pages?: { label: string; path: string }[];
  topScripts?: ScriptRow[];
  pageRoles?: Record<string, string>;
  staleScanWarning?: boolean;
  foldAssertionOk?: boolean;
  foldViolations?: unknown[];
};

export default function Step2AuditTable({
  summary,
  config,
  scope,
  pendingToken,
  readOnly,
  onTokenAction,
}: {
  summary: AuditSummaryPayload;
  config: Record<string, unknown>;
  scope: TemplateScope;
  pendingToken: string | null;
  readOnly?: boolean;
  onTokenAction: (token: string, action: string) => void;
}) {
  const [scriptSort, setScriptSort] = useState({ col: "size", dir: "desc" as "asc" | "desc" });

  const scriptLists = useMemo(
    () => scriptListStateForTab(config, scope),
    [config, scope],
  );
  const globalLists = useMemo(
    () => scriptListStateForScope(config, "global"),
    [config],
  );

  const sortedScripts = useMemo(() => {
    const rows = scriptsForScope(summary.topScripts, summary.pageRoles, scope);
    const { col, dir } = scriptSort;
    return [...rows].sort((a, b) => {
      const c = compareScriptRows(a, b, col, scriptLists);
      return dir === "asc" ? c : -c;
    });
  }, [summary.topScripts, summary.pageRoles, scope, scriptSort, scriptLists]);

  const toggleScriptSort = (colId: string) => {
    setScriptSort((prev) =>
      prev.col === colId
        ? { col: colId, dir: prev.dir === "asc" ? "desc" : "asc" }
        : {
            col: colId,
            dir:
              colId === "name" || colId === "domain" || colId === "status"
                ? "asc"
                : "desc",
          },
    );
  };

  const foldAssertionOk = summary.foldAssertionOk ?? true;
  const foldViolations = summary.foldViolations ?? [];

  return (
    <div style={{ marginBottom: 24, maxWidth: 960, margin: "30px auto 24px" }}>
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>
          Scan summary
        </div>
        {summary.completedAt && (
          <div style={{ fontSize: 13, color: "#6B7177", marginTop: 6 }}>
            {new Date(summary.completedAt).toLocaleString()}
            {summary.pages?.length
              ? ` · ${summary.pages.map((p) => p.label).join(" · ")}`
              : ""}
          </div>
        )}
      </div>

      {summary.staleScanWarning && (
        <div className="pp-banner pp-banner--warning" style={{ marginBottom: 12 }}>
          This scan is over 30 days old. Turn the app off and on to scan again.
        </div>
      )}

      {!foldAssertionOk && (
        <div className="pp-banner pp-banner--warning" style={{ marginBottom: 12 }}>
          Below-fold hiding was not applied ({foldViolations.length} fold issue
          {foldViolations.length === 1 ? "" : "s"}).
        </div>
      )}

      <div
        style={{
          fontSize: 13,
          color: "#6B7177",
          marginBottom: 8,
          textAlign: "right",
        }}
      >
        {sortedScripts.length} script{sortedScripts.length === 1 ? "" : "s"} on
        this store
      </div>
      <div
        style={{
          overflowX: "auto",
          overflowY: "auto",
          maxHeight: 520,
          border: "1px solid #E8EAED",
          borderRadius: 12,
          boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#F9FAFB", textAlign: "left" }}>
              {SCRIPT_TABLE_COLUMNS.map(({ id, label }) => {
                const active = scriptSort.col === id;
                const arrow = active ? (scriptSort.dir === "asc" ? " ↑" : " ↓") : "";
                const pinned = id === "action";
                return (
                  <th
                    key={id}
                    style={{
                      padding: "10px 12px",
                      borderBottom: "1px solid #E5E7EB",
                      fontWeight: 600,
                      color: "#374151",
                      position: "sticky",
                      top: 0,
                      right: pinned ? 0 : undefined,
                      background: "#F9FAFB",
                      zIndex: pinned ? 3 : 1,
                      cursor: "pointer",
                      userSelect: "none",
                      whiteSpace: "nowrap",
                      boxShadow: pinned
                        ? "-8px 0 8px -8px rgba(0,0,0,0.15)"
                        : undefined,
                    }}
                    onClick={() => toggleScriptSort(id)}
                  >
                    {label}
                    {arrow}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {sortedScripts.map((row, idx) => {
              const actionValue = scriptActionSelectValue(row, scriptLists);
              const saving = pendingToken === row.token;
              return (
                <tr
                  key={row.token}
                  style={{
                    borderBottom: "1px solid #F3F4F6",
                    background: idx % 2 === 0 ? "#fff" : "#FAFAFA",
                  }}
                >
                  <td
                    style={{
                      padding: "10px 12px",
                      fontFamily: "ui-monospace, monospace",
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                    title={row.token}
                  >
                    {row.token}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#374151" }}>
                    {row.domain || "—"}
                  </td>
                  <td style={{ padding: "10px 12px", color: "#6B7280" }}>
                    script
                  </td>
                  <td style={{ padding: "10px 12px", textAlign: "right" }}>
                    {row.homeRequestOrder != null ? row.homeRequestOrder : "—"}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      textAlign: "right",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {row.homeStartMs != null
                      ? `${Math.round(row.homeStartMs)} ms`
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                    {formatScriptSize(row)}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {row.durationMs != null
                      ? `${Math.round(row.durationMs)} ms`
                      : "—"}
                  </td>
                  <td style={{ padding: "10px 12px" }}>{row.status}</td>
                  <td
                    style={{
                      padding: "10px 12px",
                      position: "sticky",
                      right: 0,
                      background: idx % 2 === 0 ? "#fff" : "#FAFAFA",
                      zIndex: 1,
                      boxShadow: "-8px 0 8px -8px rgba(0,0,0,0.12)",
                    }}
                  >
                    <select
                      value={actionValue}
                      disabled={saving || readOnly}
                      onChange={(e) => {
                        const action = e.target.value;
                        if (action === actionValue) return;
                        onTokenAction(row.token, action);
                      }}
                      style={{
                        fontSize: 12,
                        maxWidth: 176,
                        padding: "6px 12px",
                        borderRadius: 999,
                        border: "1px solid #E5E7EB",
                        background: "#fff",
                        color: "#374151",
                      }}
                      aria-label={`Action for ${row.token}`}
                    >
                      {SCRIPT_ACTION_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                    {scope !== "global" &&
                      (globalLists.auditDeferArray.includes(row.token) ||
                        globalLists.firstUserDelayScripts.includes(row.token) ||
                        globalLists.staticDeferDefaults.includes(row.token)) && (
                        <div
                          style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}
                        >
                          Also in Global
                        </div>
                      )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
