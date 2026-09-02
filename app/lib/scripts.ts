import type { PredefinedScript } from "../types/script";

/**
 * The predefined scripts shown in the Step-2 wizard. The audit script has
 * been removed — script_1 is now a small dummy placeholder that only
 * exercises the delivery path (see api.script.jsx, which is the actual
 * injection point). These entries exist so the wizard still has 3 defined
 * slots to toggle; real logic is added before go-live.
 */

const SCRIPT_1_DUMMY = `
  (function () {
    // Dummy script 1 placeholder - no-op. Replaced with real logic before go-live.
    if (window.PerformanceApp) window.PerformanceApp.injected = true;
  })();
`;

const SCRIPT_2_DUMMY = `
  (function () {
    // Dummy script 2 placeholder - no-op. Replaced with real logic before go-live.
    if (window.PerformanceApp) window.PerformanceApp.ready = true;
  })();
`;

export const PREDEFINED_SCRIPTS: PredefinedScript[] = [
  {
    id: "script_1",
    name: "Dummy Script 1",
    type: "script",
    code: SCRIPT_1_DUMMY,
    defaultEnabled: false,
  },
  {
    id: "script_2",
    name: "Dummy Script 2",
    type: "script",
    code: SCRIPT_2_DUMMY,
    defaultEnabled: false,
  },
  {
    id: "script_3",
    name: "Dummy Style",
    type: "style",
    code: "/* Performance App dummy styles - no-op placeholder. */",
    defaultEnabled: false,
  },
];

export function getPredefinedScript(
  id: PredefinedScript["id"],
): PredefinedScript | undefined {
  return PREDEFINED_SCRIPTS.find((s) => s.id === id);
}
