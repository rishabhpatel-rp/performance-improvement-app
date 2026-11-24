/**
 * Sprint 1 observability helpers (AUDIT-OPTIMIZATION-ANALYSIS-2026-11-24 §8).
 * Pure functions — safe for unit tests without Playwright/Prisma.
 */
import {
  MAX_DIGITS,
  NEVER_DEFER_CMP_PATTERNS,
  NEVER_DEFER_PREFIXES,
  NEVER_DEFER_SUBSTRINGS,
  NOISE_SUBSTRINGS,
  THEME_OWNED_DIRS,
  type CandidateClass,
} from "./audit-candidates.ts";

export type CandidateGate =
  "never-path-substring" | "never-stem-prefix-cmp" | "gate-4c-assets" | "gate-4e-noise" | "kept";

/** Which gate would fire for `classifyCandidate` (including commented 4-C / 4-E). */
export function classifyCandidateGate(token: string): {
  classification: CandidateClass;
  gate: CandidateGate;
  /** True when only a commented-out gate would have blocked (currently kept). */
  commentedGateWouldBlock: boolean;
} {
  const a = String(token).toLowerCase();
  const base = a.split("/").pop() || a;
  const stem = base.replace(/\.(min\.)?(js|mjs)$/i, "");

  if (NEVER_DEFER_SUBSTRINGS.some((s) => a.startsWith(`${s}/`) || a.includes(`/${s}/`))) {
    return {
      classification: "never-defer",
      gate: "never-path-substring",
      commentedGateWouldBlock: false,
    };
  }
  if (
    NEVER_DEFER_PREFIXES.some((p) => stem.indexOf(p) === 0) ||
    NEVER_DEFER_SUBSTRINGS.some((s) => stem.indexOf(s) !== -1) ||
    NEVER_DEFER_CMP_PATTERNS.some((s) => a.indexOf(s) !== -1)
  ) {
    return {
      classification: "never-defer",
      gate: "never-stem-prefix-cmp",
      commentedGateWouldBlock: false,
    };
  }

  const parentDir = a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "";
  const would4C = THEME_OWNED_DIRS.some((d) => parentDir === d || parentDir.startsWith(`${d}/`));
  if (would4C) {
    return { classification: "kept", gate: "gate-4c-assets", commentedGateWouldBlock: true };
  }

  const would4E =
    /^\d+$/.test(stem) ||
    (stem.match(/\d/g) || []).length > MAX_DIGITS ||
    NOISE_SUBSTRINGS.some((s) => a.indexOf(s) !== -1);
  if (would4E) {
    return { classification: "kept", gate: "gate-4e-noise", commentedGateWouldBlock: true };
  }

  return { classification: "kept", gate: "kept", commentedGateWouldBlock: false };
}

export function setsAreEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

export function setDiff(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const x of a) if (!b.has(x)) out.push(x);
  return out;
}

export type PassTokenPage = { acc: { p: string[] }; settle?: { hitSafetyNet?: boolean } };

/** Tokens emitted as kept candidates (`acc.p`) for one pass index. */
export function collectTokensFromPass(
  measuredAll: PassTokenPage[],
  urlsLen: number,
  pass: number,
): Set<string> {
  const start = pass * urlsLen;
  const end = start + urlsLen;
  const set = new Set<string>();
  for (let i = start; i < Math.min(end, measuredAll.length); i++) {
    for (const t of measuredAll[i]?.acc?.p ?? []) set.add(t);
  }
  return set;
}

export function summarizeSafetyNet(pages: Array<{ settle?: { hitSafetyNet?: boolean } }>): {
  hits: number;
  total: number;
  rate: number;
} {
  const total = pages.length;
  const hits = pages.filter((p) => p.settle?.hitSafetyNet === true).length;
  return { hits, total, rate: total > 0 ? hits / total : 0 };
}

export function summarizeGateFunnel(tokens: Iterable<string>): {
  byGate: Record<CandidateGate, number>;
  wouldGate4C: number;
  wouldGate4E: number;
} {
  const byGate: Record<CandidateGate, number> = {
    "never-path-substring": 0,
    "never-stem-prefix-cmp": 0,
    "gate-4c-assets": 0,
    "gate-4e-noise": 0,
    kept: 0,
  };
  let wouldGate4C = 0;
  let wouldGate4E = 0;
  for (const token of tokens) {
    const { gate } = classifyCandidateGate(token);
    byGate[gate] += 1;
    if (gate === "gate-4c-assets") wouldGate4C += 1;
    if (gate === "gate-4e-noise") wouldGate4E += 1;
  }
  return { byGate, wouldGate4C, wouldGate4E };
}
