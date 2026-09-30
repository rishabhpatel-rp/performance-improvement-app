import type { PredefinedScript } from "../types/script";

/**
 * The predefined scripts shown in the Step-2 wizard.
 *
 * (Two `SCRIPT_*_DUMMY` no-op placeholders used to live here. They were never
 * referenced, and the `window.PerformanceApp` API they poked at does not exist
 * anywhere in the codebase — so they were removed rather than left to look like
 * real script content.)
 *
 * `PREDEFINED_SCRIPTS` is still empty and `script1/2/3Enabled` have no effect
 * on the storefront bundle (see `performance-script.server.ts`, which builds the real
 * storefront script from the audit's defer/hide arrays). Filling these in
 * with real script content and wiring the per-script toggles into the
 * generated bundle is open work (REQUIREMENTS_AND_PLANS.md, R1 issue #3) —
 * not done here because it needs the actual script content decided first.
 */

export const PREDEFINED_SCRIPTS: PredefinedScript[] = [];

export function getPredefinedScript(
  id: PredefinedScript["id"],
): PredefinedScript | undefined {
  return PREDEFINED_SCRIPTS.find((s) => s.id === id);
}
