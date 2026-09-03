// Legacy static flag. The live, per-session toggle now lives in
// `demo-mode.ts` (cookie-backed, switchable from the top bar / settings
// page without a restart). This flag is kept only as the *default* value
// used the first time a browser visits with no `demo_mode` cookie set yet,
// so existing deployments that already set `SHOW_DUMMY_DATA=true` keep
// showing dummy data until someone explicitly flips the toggle in the UI.
export const showDummyData: boolean = process.env.SHOW_DUMMY_DATA === "true";
