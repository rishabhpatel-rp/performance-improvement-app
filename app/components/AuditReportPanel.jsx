/* eslint-disable react/prop-types */
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import {
  inferScriptActionFromLists,
  scriptListStateForScope,
} from "../lib/audit-script-actions";
import PpPillButton from "./PpPillButton";

const MAIN_TABS = ["Overview", "Scripts"];

const SCRIPT_ACTION_OPTIONS = [
  { value: "defer", label: "Defer until interaction" },
  { value: "delay_first", label: "Delay (first user)" },
  { value: "delay_every", label: "Delay (every visit)" },
  { value: "protected", label: "Keep protected" },
];

const SCRIPT_TABLE_COLUMNS = [
  { id: "name", label: "Name" },
  { id: "type", label: "Type" },
  { id: "req", label: "Req #" },
  { id: "timeline", label: "Timeline" },
  { id: "size", label: "Size" },
  { id: "time", label: "Time" },
  { id: "pages", label: "Pages" },
  { id: "status", label: "Status" },
  { id: "action", label: "Action" },
];

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
      va = num(a.kb);
      vb = num(b.kb);
      break;
    case "time":
      va = num(a.durationMs);
      vb = num(b.durationMs);
      break;
    case "pages":
      va = str(a.pages?.join(", "));
      vb = str(b.pages?.join(", "));
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

export default function AuditReportPanel({
  summary,
  auditStatus,
  appEnabled,
  passwordProtected = false,
  templateConfig = null,
}) {
  const actionFetcher = useFetcher();
  const revalidator = useRevalidator();
  const [tab, setTab] = useState(passwordProtected ? "Scripts" : "Overview");
  const [pageIndex, setPageIndex] = useState(0);
  const [device, setDevice] = useState("mobile");
  const [pendingToken, setPendingToken] = useState(null);
  const [scriptSort, setScriptSort] = useState({ col: "size", dir: "desc" });
  const [scriptScope, setScriptScope] = useState("global");

  const SCRIPT_SCOPE_TABS = [
    { id: "global", label: "Global" },
    { id: "home", label: "Home" },
    { id: "collection", label: "Collection" },
    { id: "product", label: "Product" },
  ];

  useEffect(() => {
    if (actionFetcher.state === "idle" && actionFetcher.data?.ok) {
      setPendingToken(null);
      void revalidator.revalidate();
    }
  }, [actionFetcher.state, actionFetcher.data, revalidator]);

  useEffect(() => {
    if (passwordProtected) setTab("Scripts");
  }, [passwordProtected]);

  const visibleTabs = passwordProtected ? ["Scripts"] : MAIN_TABS;

  const pageViews = summary?.pageSpeedViews?.length
    ? summary.pageSpeedViews
    : (summary?.pages ?? []).map((p) => ({ label: p.label, path: p.path }));

  const activePage = pageViews[pageIndex] ?? pageViews[0];
  const lhView =
    device === "mobile" ? activePage?.mobile : activePage?.desktop ?? activePage?.mobile;

  const scriptLists = useMemo(
    () => scriptListStateForScope(templateConfig, scriptScope),
    [templateConfig, scriptScope],
  );

  const sortedScripts = useMemo(() => {
    const roles = summary?.pageRoles || {};
    const pathsForRole = (role) =>
      Object.entries(roles)
        .filter(([, r]) => r === role)
        .map(([p]) => p);

    let rows = [...(summary?.topScripts || [])];
    if (scriptScope !== "global") {
      const rolePaths = new Set(pathsForRole(scriptScope));
      rows = rows.filter((r) => r.pages?.some((p) => rolePaths.has(p)));
    }
    const { col, dir } = scriptSort;
    rows.sort((a, b) => {
      const c = compareScriptRows(a, b, col, scriptLists);
      return dir === "asc" ? c : -c;
    });
    return rows;
  }, [summary?.topScripts, summary?.pageRoles, scriptSort, scriptLists, scriptScope]);

  const toggleScriptSort = (colId) => {
    setScriptSort((prev) =>
      prev.col === colId
        ? { col: colId, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { col: colId, dir: colId === "name" || colId === "pages" || colId === "status" ? "asc" : "desc" },
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
    <div style={{ marginBottom: 24, maxWidth: 960, margin: "0 auto 24px" }}>
      <div style={{ marginBottom: 16, textAlign: "center" }}>
        <div style={{ fontSize: 17, fontWeight: 700, color: "#111827" }}>Scan summary</div>
        <div style={{ fontSize: 13, color: "#6B7177", marginTop: 6 }}>
          {new Date(summary.completedAt).toLocaleString()} ·{" "}
          {summary.pages.map((p) => p.label).join(" · ")}
        </div>
      </div>

      {summary.staleScanWarning && (
        <s-banner tone="warning" style={{ marginBottom: 12 }}>
          This scan is over 30 days old — run a new scan from Step 1 for fresh scores.
        </s-banner>
      )}

      {!foldAssertionOk && (
        <s-banner tone="warning" style={{ marginBottom: 12 }}>
          Below-fold hiding was not applied ({foldViolations.length} fold issue
          {foldViolations.length === 1 ? "" : "s"}).
        </s-banner>
      )}

      {passwordProtected && (
        <s-banner tone="info" style={{ marginBottom: 12 }}>
          PageSpeed Overview is hidden while your storefront is password-protected. Script
          results below still come from the PagePulse audit.
        </s-banner>
      )}

      {!passwordProtected && summary.psiSkipNote && (
        <s-banner
          tone={summary.psiSkipNote.includes("password") ? "info" : "warning"}
          style={{ marginBottom: 12 }}
        >
          {summary.psiSkipNote}
        </s-banner>
      )}

      {visibleTabs.length > 1 && (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 8,
            marginBottom: 20,
          }}
        >
          {visibleTabs.map((name) => (
            <PpPillButton key={name} active={tab === name} onClick={() => setTab(name)}>
              {name}
            </PpPillButton>
          ))}
        </div>
      )}

      {tab === "Overview" && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {pageViews.map((p, i) => (
                <PpPillButton
                  key={p.path}
                  active={pageIndex === i}
                  onClick={() => setPageIndex(i)}
                >
                  {p.label}
                </PpPillButton>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {["mobile", "desktop"].map((d) => (
                <PpPillButton key={d} active={device === d} onClick={() => setDevice(d)}>
                  {d === "mobile" ? "Mobile" : "Desktop"}
                </PpPillButton>
              ))}
            </div>
          </div>
          {lhView ? (
            <OverviewLighthouse view={lhView} pageLabel={activePage?.label ?? "Page"} />
          ) : (
            <s-banner tone="info">
              Scores are loading from PageSpeed Insights. Refresh in a minute after audit.
            </s-banner>
          )}
        </div>
      )}

      {tab === "Scripts" && (
        <div>
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: 8,
              flexWrap: "wrap",
              marginBottom: 12,
            }}
          >
            {SCRIPT_SCOPE_TABS.map(({ id, label }) => (
              <PpPillButton
                key={id}
                active={scriptScope === id}
                onClick={() => setScriptScope(id)}
              >
                {label}
              </PpPillButton>
            ))}
          </div>
          <div
            style={{
              fontSize: 13,
              color: "#6B7177",
              marginBottom: 8,
              textAlign: "right",
            }}
          >
            {sortedScripts.length} script{sortedScripts.length === 1 ? "" : "s"}
            {scriptScope === "global"
              ? " (all audited pages)"
              : ` (${SCRIPT_SCOPE_TABS.find((t) => t.id === scriptScope)?.label} template)`}
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
                    const sortable = true;
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
                          background: "#F9FAFB",
                          zIndex: 1,
                          cursor: sortable ? "pointer" : "default",
                          userSelect: "none",
                          whiteSpace: "nowrap",
                        }}
                        onClick={sortable ? () => toggleScriptSort(id) : undefined}
                        aria-sort={
                          sortable && active
                            ? scriptSort.dir === "asc"
                              ? "ascending"
                              : "descending"
                            : undefined
                        }
                      >
                        {label}
                        {sortable ? arrow : ""}
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
                    <td style={{ padding: "10px 12px", color: "#6B7280" }}>script</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>
                      {row.homeRequestOrder != null ? row.homeRequestOrder : "—"}
                    </td>
                    <td
                      style={{ padding: "10px 12px", textAlign: "right" }}
                      title={
                        row.homeStartMs != null
                          ? "Ms from navigation start on home"
                          : undefined
                      }
                    >
                      {row.homeStartMs != null ? `${Math.round(row.homeStartMs)} ms` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px" }}>{row.kb != null ? `${row.kb} kB` : "—"}</td>
                    <td style={{ padding: "10px 12px" }}>
                      {row.durationMs != null ? `${Math.round(row.durationMs)} ms` : "—"}
                    </td>
                    <td style={{ padding: "10px 12px", color: "#6B7280" }}>{row.pages.join(", ")}</td>
                    <td style={{ padding: "10px 12px" }}>{row.status}</td>
                    <td style={{ padding: "10px 12px" }}>
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
                              scope: scriptScope,
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
      )}
    </div>
  );
}
