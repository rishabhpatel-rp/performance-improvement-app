/** Dashboard audit state machine (CQ-7). One source of truth for the wizard's
 *  idle → queued → discovering → running → complete | failed transitions. */

export type AuditState = "idle" | "queued" | "discovering" | "running" | "complete" | "failed";

export type AuditStateInput = {
  expectingAudit?: boolean;
  running?: boolean;
  complete?: boolean;
  failed?: boolean;
  phase?: string | null;
};

export function deriveAuditState(input: AuditStateInput): AuditState {
  if (input.failed) return "failed";
  if (input.complete && !input.running) return "complete";
  if (!input.expectingAudit && !input.running) return "idle";
  if (input.phase === "queued") return "queued";
  if (input.phase === "discovering") return "discovering";
  return "running";
}

export type DashboardState = { audit: AuditState; currentStep: 1 | 2 };

export type DashboardAction =
  | { type: "AUDIT_STARTED" }
  | { type: "PHASE"; phase: string | null }
  | { type: "AUDIT_COMPLETE" }
  | { type: "AUDIT_FAILED" }
  | { type: "RESET" }
  | { type: "GO_TO_STEP"; step: 1 | 2 };

export function dashboardReducer(state: DashboardState, action: DashboardAction): DashboardState {
  switch (action.type) {
    case "AUDIT_STARTED":
      return { ...state, audit: "queued", currentStep: 1 };
    case "PHASE":
      if (state.audit === "complete" || state.audit === "failed") return state;
      if (action.phase === "queued") return { ...state, audit: "queued" };
      if (action.phase === "discovering") return { ...state, audit: "discovering" };
      return { ...state, audit: "running" };
    case "AUDIT_COMPLETE":
      return { ...state, audit: "complete", currentStep: 2 };
    case "AUDIT_FAILED":
      return { ...state, audit: "failed", currentStep: 1 };
    case "RESET":
      return { audit: "idle", currentStep: 1 };
    case "GO_TO_STEP":
      return { ...state, currentStep: action.step };
    default:
      return state;
  }
}

export function deriveMaxStep(
  state: AuditState,
  appEnabled: boolean,
  extensionBlocked: boolean,
): 1 | 2 {
  return appEnabled && !extensionBlocked && state === "complete" ? 2 : 1;
}
