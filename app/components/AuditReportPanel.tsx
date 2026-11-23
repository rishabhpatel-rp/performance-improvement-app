/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy components */
import { useEffect, useMemo, useState } from "react";
import { severityLabel, filterScriptRows, copyableValue } from "../lib/report-table.ts";
import { useFetcher, useRevalidator } from "react-router";
import { scriptListStateForScope, scriptListStateForTab } from "../lib/audit-script-actions";
import { scriptsForScope, tabDropdownAction } from "../lib/scan-summary-scope";

interface Props {
  summary?: any;
  auditStatus?: any;
  appEnabled?: boolean;
  templateConfig?: Record<string, unknown> | null;
  scope?: string;
}

const SCRIPT_ACTION_OPTIONS = [
  { value: "defer", label: "Defer until interaction" },
  { value: "delay_first", label: "Delay (first user)" },
  { value: "delay_every", label: "Delay (every visit)" },
  { value: "protected", label: "Keep protected" },
];

const SCRIPT_TABLE_COLUMNS = [
  { id: "name", label: "Name" },
  { id: "domain", label: "Domain" },
  { id: "category", label: "Category" },
  { id: "tier", label: "Audit tier" },
  { id: "type", label: "Type" },
  { id: "req", label: "Req #" },
  { id: "timeline", label: "Timeline" },
  { id: "size", label: "Size" },
  { id: "time", label: "Time" },
  { id: "status", label: "Status" },
  { id: "action", label: "Action" },
];

function formatScriptSize(row: any) {
  const bytes = row.bytes > 0 ? row.bytes : row.kb > 0 ? row.kb * 1024 : 0;
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb >= 100 ? `${Math.round(kb)} kB` : `${kb.toFixed(1)} kB`;
}

function scriptActionSelectValue(row: any, lists: any) {
  return tabDropdownAction(
    {
      auditDeferArray: lists.auditDeferArray,
      firstUserDelayScripts: lists.firstUserDelayScripts,
      staticDeferDefaults: lists.staticDeferDefaults,
    },
    row.token,
  );
}

function compareScriptRows(a: any, b: any, colId: any, lists: any) {
  const str = (v: any) => String(v ?? "").toLowerCase();
  const num = (v: any) => (v == null || Number.isNaN(v) ? null : Number(v));
  let va;
  let vb;
  switch (colId) {
    case "name":
      va = str(a.token);
      vb = str(b.token);
      break;
    case "domain":
      va = str(a.domain);
      vb = str(b.domain);
      break;
    case "category":
      va = str(a.scriptCategory);
      vb = str(b.scriptCategory);
      break;
    case "tier":
      va = str(a.deferTier);
      vb = str(b.deferTier);
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
      va = num(a.bytes > 0 ? a.bytes : a.kb);
      vb = num(b.bytes > 0 ? b.bytes : b.kb);
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

const IMAGE_ISSUE_META = {
  "lazy-above-fold": {
    label: "Lazy-load on above-fold image",
    color: "#DC2626",
    icon: "⚠️",
    lcpImpact: "Delays LCP by 1 extra round-trip",
  },
  "missing-fetchpriority": {
    label: "Missing fetchpriority=high",
    color: "#D97706",
    icon: "⚡",
    lcpImpact: "Browser discovers image late in preload queue",
  },
  oversized: {
    label: "Oversized image",
    color: "#2563EB",
    icon: "📦",
    lcpImpact: "Wastes bandwidth, slows LCP",
  },
};

function ImageRecommendationsPanel({ imageRecommendations }: any) {
  if (!imageRecommendations) return null;
  const allIssues = Object.entries(imageRecommendations).flatMap(([path, issues]: any[]) =>
    (issues as any[]).map((issue: any) => ({ ...issue, path })),
  );
  if (!allIssues.length) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 10 }}>
        🖼 Above-fold image issues ({allIssues.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {allIssues.map((issue, idx) => {
          const meta = (IMAGE_ISSUE_META as Record<string, any>)[issue.issue] || {};
          return (
            <div
              key={idx}
              style={{
                border: `1px solid ${meta.color}33`,
                borderLeft: `4px solid ${meta.color}`,
                borderRadius: 8,
                padding: "12px 16px",
                background: "#FAFAFA",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 15 }}>{meta.icon}</span>
                <span style={{ fontWeight: 600, color: meta.color, fontSize: 13 }}>
                  {meta.label}
                </span>
                <span style={{ fontSize: 11, color: "#6B7280", marginLeft: "auto" }}>
                  {issue.path}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "#374151", marginBottom: 4 }}>
                {issue.description}
              </div>
              {issue.src && (
                <div
                  style={{
                    fontSize: 11,
                    color: "#6B7280",
                    marginBottom: 6,
                    wordBreak: "break-all",
                  }}
                >
                  <strong>Image:</strong>{" "}
                  <code style={{ background: "#F3F4F6", padding: "1px 4px", borderRadius: 4 }}>
                    {issue.src.length > 80 ? `…${issue.src.slice(-80)}` : issue.src}
                  </code>
                </div>
              )}
              <div
                style={{
                  fontSize: 12,
                  color: "#065F46",
                  background: "#ECFDF5",
                  borderRadius: 6,
                  padding: "6px 10px",
                }}
              >
                <strong>Fix:</strong> {issue.fix}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function AuditReportPanel({
  summary,
  auditStatus,
  appEnabled,
  templateConfig = null,
  scope = "global",
}: Props) {
  const actionFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [pendingToken, setPendingToken] = useState(null);
  const [scriptSort, setScriptSort] = useState({ col: "size", dir: "desc" });
  const [scriptQuery, setScriptQuery] = useState("");
  const [visibleScripts, setVisibleScripts] = useState(20);

  useEffect(() => {
    if (actionFetcher.state === "idle" && actionFetcher.data?.ok) {
      setPendingToken(null);
      void revalidator.revalidate();
    }
  }, [actionFetcher.state, actionFetcher.data, revalidator]);

  const scriptLists = useMemo(
    () => scriptListStateForTab(templateConfig, scope as any),
    [templateConfig, scope],
  );
  const globalLists = useMemo(
    () => scriptListStateForScope(templateConfig, "global"),
    [templateConfig],
  );

  const sortedScripts = useMemo(() => {
    const rows = scriptsForScope(summary?.topScripts || [], summary?.pageRoles, scope);
    const { col, dir } = scriptSort;
    rows.sort((a, b) => {
      const c = compareScriptRows(a, b, col, scriptLists);
      return dir === "asc" ? c : -c;
    });
    return rows;
  }, [summary?.topScripts, summary?.pageRoles, scope, scriptSort, scriptLists]);

  const filteredScripts = useMemo(
    () => filterScriptRows(sortedScripts, scriptQuery),
    [sortedScripts, scriptQuery],
  );
  const visibleRows = filteredScripts.slice(0, visibleScripts);

  const toggleScriptSort = (colId: any) => {
    setScriptSort((prev) =>
      prev.col === colId
        ? { col: colId, dir: prev.dir === "asc" ? "desc" : "asc" }
        : {
            col: colId,
            dir: colId === "name" || colId === "domain" || colId === "status" ? "asc" : "desc",
          },
    );
  };

  if (!appEnabled) {
    return (
      <s-banner tone="info">Enable PagePulse in Step 1 to run a scan and see results.</s-banner>
    );
  }

  if (auditStatus?.running) {
    return (
      <s-banner tone="info">
        Scan in progress — results appear here when the audit finishes.
      </s-banner>
    );
  }

  if (!summary) {
    return null;
  }

  const { foldAssertionOk, foldViolations } = summary;

  return (
    <div style={{ marginBottom: 24, maxWidth: 960, margin: "30px auto 24px" }}>
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Scan summary</div>
        <div style={{ fontSize: 13, color: "#6B7177", marginTop: 6 }}>
          {new Date(summary.completedAt).toLocaleString()} ·{" "}
          {summary.pages.map((p: any) => p.label).join(" · ")}
        </div>
      </div>

      {summary.staleScanWarning && (
        <s-banner tone="warning" style={{ marginBottom: 12 }}>
          This scan is over 30 days old. Turn the app off and on to scan again.
        </s-banner>
      )}

      {!foldAssertionOk && (
        <s-banner tone="warning" style={{ marginBottom: 12 }}>
          Below-fold hiding was not applied ({foldViolations.length} fold issue
          {foldViolations.length === 1 ? "" : "s"}).
        </s-banner>
      )}

      <div>
        <div
          style={{
            fontSize: 13,
            color: "#6B7177",
            marginBottom: 8,
            textAlign: "right",
          }}
        >
          {filteredScripts.length} script{filteredScripts.length === 1 ? "" : "s"} on this store
        </div>
        <input
          type="search"
          aria-label="Search scripts"
          placeholder="Search scripts by name, domain or status…"
          value={scriptQuery}
          onChange={(e: any) => {
            setScriptQuery(e.target.value);
            setVisibleScripts(20);
          }}
          className="pp-focus-ring"
          style={{
            width: "100%",
            maxWidth: 360,
            padding: "8px 10px",
            border: "1px solid #E2E7EC",
            borderRadius: 8,
            marginBottom: 8,
          }}
        />
        <div
          className="pp-table-scroll"
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
                        boxShadow: pinned ? "-8px 0 8px -8px rgba(0,0,0,0.15)" : undefined,
                      }}
                      onClick={() => toggleScriptSort(id)}
                      aria-sort={
                        active ? (scriptSort.dir === "asc" ? "ascending" : "descending") : undefined
                      }
                    >
                      {label}
                      {arrow}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row, idx) => {
                const actionKey = row.token;
                const actionValue = scriptActionSelectValue(row, scriptLists);
                const saving = pendingToken === actionKey && actionFetcher.state !== "idle";
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
                      <button
                        type="button"
                        aria-label={`Copy ${row.token}`}
                        className="pp-focus-ring"
                        style={{
                          marginLeft: 6,
                          border: 0,
                          background: "transparent",
                          cursor: "pointer",
                        }}
                        onClick={() => void navigator.clipboard.writeText(copyableValue(row))}
                      >
                        Copy
                      </button>
                    </td>
                    <td style={{ padding: "10px 12px", color: "#374151" }}>{row.domain || "—"}</td>
                    <td style={{ padding: "10px 12px", color: "#6B7280" }}>
                      {row.scriptCategory || "—"}
                    </td>
                    <td
                      style={{ padding: "10px 12px", color: "#374151" }}
                      title={row.storefrontImpact || undefined}
                    >
                      {row.deferTier || "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#6B7280" }}>script</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {row.homeRequestOrder != null ? row.homeRequestOrder : "—"}
                    </td>
                    <td
                      style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}
                      title={
                        row.homeStartMs != null ? "Milliseconds after navigation start" : undefined
                      }
                    >
                      {row.homeStartMs != null ? `${Math.round(row.homeStartMs)} ms` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", whiteSpace: "nowrap" }}>
                      {formatScriptSize(row)}
                    </td>
                    <td style={{ padding: "10px 12px" }}>
                      {row.durationMs != null ? `${Math.round(row.durationMs)} ms` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{severityLabel(String(row.status))}</td>
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
                        disabled={saving}
                        onChange={(e) => {
                          const action = e.target.value;
                          if (action === actionValue) return;
                          setPendingToken(actionKey);
                          void actionFetcher.submit(
                            {
                              intent: "script-token-action",
                              token: actionKey,
                              action,
                              scope,
                            },
                            { method: "POST" },
                          );
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
                        (globalLists.auditDeferArray.includes(actionKey) ||
                          globalLists.firstUserDelayScripts.includes(actionKey) ||
                          globalLists.staticDeferDefaults.includes(actionKey)) && (
                          <div style={{ fontSize: 11, color: "#6B7280", marginTop: 4 }}>
                            Also in Global
                          </div>
                        )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {filteredScripts.length === 0 && (
            <div style={{ padding: 16, textAlign: "center", color: "#6B7280" }} role="status">
              No scripts match your search. Try a different name or clear the filter.
            </div>
          )}
          {visibleRows.length < filteredScripts.length && (
            <div style={{ padding: 12, textAlign: "center" }}>
              <s-button
                variant="secondary"
                class="pp-focus-ring"
                onClick={() => setVisibleScripts((n) => n + 20)}
              >
                Show more ({filteredScripts.length - visibleRows.length} left)
              </s-button>
            </div>
          )}
        </div>
      </div>

      <ImageRecommendationsPanel imageRecommendations={summary.imageRecommendations} />
    </div>
  );
}
