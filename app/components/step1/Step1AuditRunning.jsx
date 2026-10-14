/* eslint-disable react/prop-types */
import { shortPath } from "./step1-shared.js";

export default function Step1AuditRunning({
  auditSteps,
  activeStepIndex,
  progressPct,
  auditPages,
  phase,
  missingPlp,
  missingPdp,
  stoppingAudit,
  onStop,
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 10,
        padding: "12px 0",
        color: "#4A5568",
        fontSize: 14,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <s-spinner />
        <span>{auditSteps[Math.max(activeStepIndex, 0)].label}…</span>
      </div>

      <s-button variant="secondary" onClick={onStop} disabled={stoppingAudit}>
        {stoppingAudit ? "Stopping…" : "Stop audit"}
      </s-button>

      <div style={{ width: "100%", maxWidth: 360 }}>
        <div
          style={{
            height: 10,
            borderRadius: 6,
            backgroundColor: "#E2E7EC",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${progressPct}%`,
              backgroundColor: "#00B856",
              borderRadius: 6,
              transition: "width 400ms ease",
            }}
          />
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          fontSize: 13,
          color: "#6B7177",
        }}
      >
        {auditSteps.map((st, i) => {
          const state =
            i < activeStepIndex ? "done" : i === activeStepIndex ? "current" : "pending";
          return (
            <div
              key={st.key}
              style={{
                fontWeight: state === "current" ? 600 : 400,
                color: state === "pending" ? "#8A9099" : "#1E3A2B",
              }}
            >
              {state === "done" ? "✓" : state === "current" ? "●" : "○"} {st.label}
            </div>
          );
        })}
      </div>

      {auditPages.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            justifyContent: "center",
          }}
        >
          {auditPages.map((p, i) => {
            const isDone = phase === "building" || p.done === true;
            return (
              <span
                key={`${p.label}-${i}`}
                title={p.path}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 4,
                  padding: "2px 10px",
                  borderRadius: 12,
                  fontSize: 12,
                  backgroundColor: isDone ? "#E6F4EA" : "#F1F3F5",
                  color: "#1E3A2B",
                }}
              >
                <span aria-hidden="true">{isDone ? "✓" : "○"}</span>
                {p.label} · {shortPath(p.path)}
              </span>
            );
          })}
        </div>
      )}

      {auditPages.length > 0 && (missingPlp || missingPdp) && (
        <div
          style={{
            fontSize: 12,
            color: "#6B7177",
            textAlign: "center",
            maxWidth: 420,
          }}
        >
          No{" "}
          {missingPlp && missingPdp
            ? "collection or product"
            : missingPlp
              ? "collection"
              : "product"}{" "}
          page was found on your store. Add the URL below for a fuller audit.
        </div>
      )}
    </div>
  );
}
