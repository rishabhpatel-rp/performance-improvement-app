/* eslint-disable react/prop-types */
const STEP_LABELS = ["Start", "Scripts", "Titles"];

/**
 * 3-circle stepper matching Desing_plan.md: active/completed = filled green
 * circle, inactive = grey, connected by a thin line. Clickable to jump
 * between steps — but steps past `maxStep` are locked (greyed out) until the
 * app is enabled in Step 1.
 */
export default function WizardProgress({ currentStep, maxStep = 3, onStepClick }) {
  return (
    <div style={{ display: "flex", alignItems: "center", padding: "8px 0 20px" }}>
      {STEP_LABELS.map((label, index) => {
        const step = index + 1;
        const isActive = step === currentStep;
        const isCompleted = step < currentStep;
        const locked = step > maxStep;
        const filled = (isActive || isCompleted) && !locked;

        return (
          <div key={label} style={{ display: "flex", alignItems: "center", flex: index < STEP_LABELS.length - 1 ? 1 : "0 0 auto" }}>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                cursor: locked ? "not-allowed" : "pointer",
                opacity: locked ? 0.5 : 1,
              }}
              role="button"
              tabIndex={locked ? -1 : 0}
              aria-disabled={locked}
              onClick={() => !locked && onStepClick?.(step)}
              onKeyDown={(e) => {
                if (!locked && (e.key === "Enter" || e.key === " ")) onStepClick?.(step);
              }}
            >
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 13,
                  fontWeight: 600,
                  color: filled ? "#FFFFFF" : "#6B7177",
                  backgroundColor: filled ? "#00B856" : "#E2E7EC",
                  transition: "background-color 120ms ease",
                }}
              >
                {step}
              </div>
              <span style={{ marginTop: 6, fontSize: 12, color: isActive && !locked ? "#00B856" : "#6B7177", fontWeight: isActive ? 600 : 400 }}>
                {label}
              </span>
            </div>
            {index < STEP_LABELS.length - 1 && (
              <div style={{ flex: 1, height: 2, backgroundColor: "#E0E0E0", margin: "0 8px 20px" }} />
            )}
          </div>
        );
      })}
    </div>
  );
}
