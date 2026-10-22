/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  inferScriptActionFromLists,
  scriptListStateForScope,
} from "../lib/audit-script-actions";

const SCRIPT_ACTION_OPTIONS = [
  { value: "defer", label: "Defer until interaction" },
  { value: "delay_first", label: "Delay (first user)" },
  { value: "delay_every", label: "Delay (every visit)" },
  { value: "protected", label: "Keep protected" },
];

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
];

function formatScriptSize(row) {
  const bytes = row.bytes > 0 ? row.bytes : row.kb > 0 ? row.kb * 1024 : 0;
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  return kb >= 100 ? `${Math.round(kb)} kB` : `${kb.toFixed(1)} kB`;
}

function scriptActionSelectValue(row, lists) {
  const inferred = inferScriptActionFromLists(lists, row.token, row.status);
  if (inferred !== "keep") return inferred;
  if (row.status === "deferred") return "defer";
  if (row.status === "never") return "protected";
  return "protected";
}

function compareScriptRows(a, b, colId, lists) {
  const str = (v) => String(v ?? "").toLowerCase();
  const num = (v) => (v == null || Number.isNaN(v) ? null : Number(v));
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

const SCORE_LABELS = [
  { key: "performance", label: "Performance" },
  { key: "accessibility", label: "Accessibility" },
  { key: "bestPractices", label: "Best practices" },
  { key: "seo", label: "SEO" },
];

const METRIC_DEFS = [
  { key: "fcp", label: "FCP", unit: "s", good: 1.8, poor: 3, max: 5, get: (m) => m.fcpSec },
  { key: "lcp", label: "LCP", unit: "s", good: 2.5, poor: 4, max: 6, get: (m) => m.lcpSec },
  { key: "tbt", label: "TBT", unit: "ms", good: 200, poor: 600, max: 1200, get: (m) => m.tbtMs },
  { key: "cls", label: "CLS", unit: "", good: 0.1, poor: 0.25, max: 0.5, get: (m) => m.cls, lowerBetter: true },
  { key: "si", label: "SI", unit: "s", good: 3.4, poor: 5.8, max: 8, get: (m) => m.speedIndexSec },
];

function scoreColor(score) {
  if (score == null) return "#9CA3AF";
  if (score >= 90) return "#16A34A";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

function metricColor(value, good, poor, lowerBetter) {
  if (value == null) return "#9CA3AF";
  if (lowerBetter) {
    if (value <= good) return "#16A34A";
    if (value >= poor) return "#DC2626";
    return "#D97706";
  }
  if (value <= good) return "#16A34A";
  if (value >= poor) return "#DC2626";
  return "#D97706";
}

function barPercent(value, good, poor, max, lowerBetter) {
  if (value == null) return 0;
  if (lowerBetter) {
    return Math.min(100, Math.max(0, (value / (poor || max)) * 100));
  }
  return Math.min(100, Math.max(0, (value / (max || poor)) * 100));
}

function useInView(threshold = 0.15) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { threshold },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

function AnimatedBar({ percent, color, animate }) {
  return (
    <div
      style={{
        height: 8,
        background: "#F3F4F6",
        borderRadius: 999,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          height: "100%",
          width: animate ? `${percent}%` : "0%",
          background: color,
          borderRadius: 999,
          transition: "width 1s cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
    </div>
  );
}

function CircularScoreGauge({ label, score, animate, size = 76 }) {
  const stroke = 5;
  const r = (size - stroke * 2) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const pct = score != null ? Math.min(100, Math.max(0, score)) / 100 : 0;
  const dashOffset = circumference * (1 - (animate ? pct : 0));
  const color = scoreColor(score);

  return (
    <div style={{ textAlign: "center", flex: "1 1 72px", minWidth: 72, maxWidth: 120 }}>
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        style={{ display: "block", margin: "0 auto" }}
        aria-hidden
      >
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke="#E8EAED"
          strokeWidth={stroke}
        />
        <circle
          cx={cx}
          cy={cy}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform={`rotate(-90 ${cx} ${cy})`}
          style={{
            transition: "stroke-dashoffset 1.1s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        />
        <text
          x={cx}
          y={cy}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize="20"
          fontWeight="700"
          fill={color}
        >
          {score ?? "—"}
        </text>
      </svg>
      <div
        style={{
          fontSize: 12,
          color: "#4B5563",
          marginTop: 8,
          lineHeight: 1.3,
          padding: "0 4px",
        }}
      >
        {label}
      </div>
    </div>
  );
}

function MetricRow({ def, metrics, animate }) {
  const raw = def.get(metrics);
  const display =
    raw == null
      ? "—"
      : def.unit === "ms"
        ? `${Math.round(raw)}`
        : def.unit === "s"
          ? raw.toFixed(1)
          : raw.toFixed(2);
  const color = metricColor(raw, def.good, def.poor, def.lowerBetter);
  const pct = barPercent(raw, def.good, def.poor, def.max, def.lowerBetter);

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        border: "1px solid #F0F0F0",
        background: "#FAFAFA",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{def.label}</span>
        <span style={{ fontSize: 18, fontWeight: 600, color }}>
          {display}
          {raw != null && def.unit ? (
            <span style={{ fontSize: 12, fontWeight: 500, color: "#6B7280" }}>{def.unit}</span>
          ) : null}
        </span>
      </div>
      <AnimatedBar percent={pct} color={color} animate={animate} />
    </div>
  );
}

// PSI overview block — not mounted in panel yet (see §8.8.1).
// eslint-disable-next-line no-unused-vars
function OverviewLighthouse({ view, pageLabel }) {
  const [ref, animate] = useInView();
  const cats = view?.categories ?? {};
  const m = view?.metrics ?? {};
  const sourceLabel = view?.source === "psi" ? "PageSpeed Insights" : "PagePulse lab";

  return (
    <div
      ref={ref}
      style={{
        border: "1px solid #E8EAED",
        borderRadius: 12,
        overflow: "hidden",
        background: "#fff",
        boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
      }}
    >
      <div
        style={{
          padding: "12px 16px",
          borderBottom: "1px solid #F0F0F0",
          fontSize: 12,
          color: "#6B7280",
        }}
      >
        {pageLabel} · {sourceLabel}
        {view?.note ? (
          <div style={{ marginTop: 6, color: "#9CA3AF", fontSize: 11 }}>{view.note}</div>
        ) : null}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-around",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 16,
          padding: "20px 16px 24px",
          borderBottom: "1px solid #F0F0F0",
        }}
      >
        {SCORE_LABELS.map(({ key, label }) => (
          <CircularScoreGauge
            key={key}
            label={label}
            score={cats[key]}
            animate={animate}
          />
        ))}
      </div>
      <div
        style={{
          padding: 16,
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
        }}
      >
        {METRIC_DEFS.map((def) => (
          <MetricRow key={def.key} def={def} metrics={m} animate={animate} />
        ))}
      </div>
    </div>
  );
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

function ImageRecommendationsPanel({ imageRecommendations }) {
  if (!imageRecommendations) return null;
  const allIssues = Object.entries(imageRecommendations).flatMap(([path, issues]) =>
    issues.map((issue) => ({ ...issue, path })),
  );
  if (!allIssues.length) return null;

  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: "#111827", marginBottom: 10 }}>
        🖼 Above-fold image issues ({allIssues.length})
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {allIssues.map((issue, idx) => {
          const meta = IMAGE_ISSUE_META[issue.issue] || {};
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
                <div style={{ fontSize: 11, color: "#6B7280", marginBottom: 6, wordBreak: "break-all" }}>
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
}) {
  const actionFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [pendingToken, setPendingToken] = useState(null);
  const [scriptSort, setScriptSort] = useState({ col: "size", dir: "desc" });

  useEffect(() => {
    if (actionFetcher.state === "idle" && actionFetcher.data?.ok) {
      setPendingToken(null);
      void revalidator.revalidate();
    }
  }, [actionFetcher.state, actionFetcher.data, revalidator]);

  const scriptLists = useMemo(
    () => scriptListStateForScope(templateConfig, "global"),
    [templateConfig],
  );

  const sortedScripts = useMemo(() => {
    const rows = [...(summary?.topScripts || [])];
    const { col, dir } = scriptSort;
    rows.sort((a, b) => {
      const c = compareScriptRows(a, b, col, scriptLists);
      return dir === "asc" ? c : -c;
    });
    return rows;
  }, [summary?.topScripts, scriptSort, scriptLists]);

  const toggleScriptSort = (colId) => {
    setScriptSort((prev) =>
      prev.col === colId
        ? { col: colId, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { col: colId, dir: colId === "name" || colId === "domain" || colId === "status" ? "asc" : "desc" },
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
    return (
      <s-banner tone="info">Complete a scan from Step 1 to see results.</s-banner>
    );
  }

  const { foldAssertionOk, foldViolations } = summary;

  return (
    <div style={{ marginBottom: 24, maxWidth: 960, margin: "30px auto 24px" }}>
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Scan summary</div>
        <div style={{ fontSize: 13, color: "#6B7177", marginTop: 6 }}>
          {new Date(summary.completedAt).toLocaleString()} ·{" "}
          {summary.pages.map((p) => p.label).join(" · ")}
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
            {sortedScripts.length} script{sortedScripts.length === 1 ? "" : "s"} on this store
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
                          boxShadow: pinned ? "-8px 0 8px -8px rgba(0,0,0,0.15)" : undefined,
                        }}
                        onClick={() => toggleScriptSort(id)}
                        aria-sort={
                          active
                            ? scriptSort.dir === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
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
              {sortedScripts.map((row, idx) => {
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
                    </td>
                    <td style={{ padding: "10px 12px", color: "#374151" }}>
                      {row.domain || "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#6B7280" }}>script</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {row.homeRequestOrder != null ? row.homeRequestOrder : "—"}
                    </td>
                    <td
                      style={{ padding: "10px 12px", textAlign: "right", whiteSpace: "nowrap" }}
                      title={
                        row.homeStartMs != null
                          ? "Milliseconds after navigation start"
                          : undefined
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
                        disabled={saving}
                        onChange={(e) => {
                          const action = e.target.value;
                          if (action === actionValue) return;
                          setPendingToken(actionKey);
                          actionFetcher.submit(
                            {
                              intent: "script-token-action",
                              token: actionKey,
                              action,
                              scope: "global",
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
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>

      <ImageRecommendationsPanel imageRecommendations={summary.imageRecommendations} />
    </div>
  );
}
