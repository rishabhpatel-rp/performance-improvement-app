import {
  type DeferTier,
  type ScriptLoadingHint,
  shouldProtectUnknownCoverageScript,
} from "./audit-candidates.ts";

export const DEFER_THRESHOLD = 55;
/** Lower confidence bar for unknown-coverage (IIFE) scripts.
 *  IIFEs with no named functions are unlikely to be render-critical theme code —
 *  theme code uses classes and named functions. Lowering the threshold for this
 *  group catches analytics/tracking scripts that load slightly early (order 10–20,
 *  startMs 800–1500ms) which the full threshold would incorrectly block. */
export const DEFER_THRESHOLD_UNKNOWN = 42;

export type CoverageVerdictLabel = "ran" | "unknown" | "idle";

export interface ConfidenceInput {
  coverageVerdict: CoverageVerdictLabel;
  loadingHint: ScriptLoadingHint;
  homeRequestOrder?: number;
  homeStartMs?: number;
  bytes?: number;
  tbtContributionMs?: number;
  /** Home-page DOM mutations (used as signal for unknown coverage scripts). */
  domMutationCount?: number;
  appearsOnPages?: number;
  totalPages?: number;
}

export function computeDeferConfidence(input: ConfidenceInput): number {
  let score = 50;

  if (input.coverageVerdict === "idle") score += 35;
  else if (input.coverageVerdict === "unknown") score -= 5;
  else score -= 40;

  const hint = input.loadingHint;
  if (hint === "module" || hint === "defer") score += 12;
  else if (hint === "async") score += 8;
  else if (hint === "nomodule") score += 15;
  else if (hint === "blocking") score -= 5;

  const order = input.homeRequestOrder ?? 999;
  if (order <= 5) score -= 25;
  else if (order <= 10) score -= 15;
  else if (order <= 20) score -= 5;
  else if (order > 30) score += 10;

  const startMs = input.homeStartMs ?? 9999;
  if (startMs < 500) score -= 20;
  else if (startMs < 1000) score -= 10;
  else if (startMs > 2500) score += 10;
  else if (startMs > 1500) score += 5;

  const tbt = input.tbtContributionMs ?? 0;
  if (tbt > 200) score -= 15;
  else if (tbt > 100) score -= 8;
  else if (tbt === 0) score += 5;

  const mut = input.domMutationCount ?? 0;
  if (mut > 800 && input.coverageVerdict === "unknown") score -= 12;
  else if (mut > 400 && input.coverageVerdict === "unknown") score -= 6;

  const bytes = input.bytes ?? 0;
  if (bytes < 5_000) score -= 8;
  else if (bytes > 50_000) score += 10;

  const appears = input.appearsOnPages ?? 1;
  const total = input.totalPages ?? 1;
  const ratio = appears / Math.max(1, total);
  if (ratio >= 1) score -= 5;

  return Math.max(0, Math.min(100, score));
}

export function classifyDeferTier(input: {
  confidence: number;
  coverageVerdict: CoverageVerdictLabel;
  homeRequestOrder?: number;
  homeStartMs?: number;
  loadingHint: ScriptLoadingHint;
}): DeferTier {
  // Use a lower threshold for IIFE / unknown-coverage scripts. A script with
  // no named functions is statistically unlikely to be theme rendering code
  // (theme code uses classes and named functions). Applying the full 55
  // threshold was filtering out analytics scripts that happen to load slightly
  // early (order 10–20, startMs 800–1500ms).
  const threshold = input.coverageVerdict === "unknown" ? DEFER_THRESHOLD_UNKNOWN : DEFER_THRESHOLD;
  if (input.confidence < threshold) return "never";
  const earlyLoad = (input.homeStartMs ?? 9999) < 1500 || (input.homeRequestOrder ?? 999) <= 15;
  if (earlyLoad && input.coverageVerdict === "idle") return "delay-every";
  if (
    !earlyLoad &&
    input.coverageVerdict === "idle" &&
    input.confidence >= 62 &&
    (input.loadingHint === "async" ||
      input.loadingHint === "defer" ||
      input.loadingHint === "module")
  ) {
    return "delay-first";
  }
  if (!earlyLoad && input.coverageVerdict === "idle") return "interaction";
  if (input.coverageVerdict === "unknown" && !earlyLoad) return "delay-every";
  if (
    input.coverageVerdict === "unknown" &&
    shouldProtectUnknownCoverageScript({
      homeRequestOrder: input.homeRequestOrder,
      homeStartMs: input.homeStartMs,
    })
  ) {
    return "never";
  }
  if (
    input.coverageVerdict === "unknown" &&
    earlyLoad &&
    !shouldProtectUnknownCoverageScript({
      homeRequestOrder: input.homeRequestOrder,
      homeStartMs: input.homeStartMs,
    })
  ) {
    return "delay-first";
  }
  return "interaction";
}
