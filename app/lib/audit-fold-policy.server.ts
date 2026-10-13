import type { FoldAssertion } from "./audit.server";

export const FOLD_ASSERTION_STRIPPED_HIDE = "FOLD_ASSERTION_STRIPPED_HIDE";

export type FoldPolicyResult =
  | { ok: true; hideSelectors: string[]; warnings: string[] }
  | {
      ok: false;
      hideSelectors: string[];
      violations: string[];
      action: "stripped";
      warnings: string[];
    };

/** D1=A — strip hide selectors when fold assertion fails; defer unchanged. */
export function applyFoldPolicy(
  hideSelectors: string[],
  foldAssertion: FoldAssertion,
): FoldPolicyResult {
  if (foldAssertion.ok) {
    return { ok: true, hideSelectors, warnings: [] };
  }
  const violations = foldAssertion.violations ?? [];
  const warnings = [
    FOLD_ASSERTION_STRIPPED_HIDE,
    ...violations.map((v) => `fold-violation:${v}`),
  ];
  return {
    ok: false,
    hideSelectors: [],
    violations,
    action: "stripped",
    warnings,
  };
}
