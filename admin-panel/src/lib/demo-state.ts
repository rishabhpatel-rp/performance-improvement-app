import { getDummyStoreByDomain } from "@/lib/dummy-data";

/** Read-only snapshot served from the dummy dataset while demo mode is on.
 *  Mirrors the fields the merchant `/state` endpoint exposes, but never
 *  touches the real store or permits writes. */
export function demoStateForDomain(domain: string) {
  const store = getDummyStoreByDomain(domain);
  if (!store) {
    return {
      ok: true,
      demoMode: true,
      shopDomain: domain,
      config: {
        appEnabled: false,
        script1Enabled: true,
        script2Enabled: true,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: ["Audit Script", "Defer Script", "Hide CSS"],
        firstUserDelayScripts: [],
        firstUserDelayMs: 12000,
        everyTimeDelayMs: 6000,
        firstUserDelayScriptsEnabled: true,
        adminManaged: false,
      },
      auditStatus: {
        running: false,
        complete: false,
        failed: false,
        progress: 0,
        pageIndex: 0,
        totalPages: 0,
        phase: null,
        queue: null,
        errorMessage: null,
      },
      version: { configUpdatedAt: null, scriptHash: null },
    };
  }
  const config = store.configs[0] ?? {};
  const auditComplete = config.auditComplete === true;
  return {
    ok: true,
    demoMode: true,
    shopDomain: store.shopDomain,
    config: {
      appEnabled: config.appEnabled === true,
      script1Enabled: config.script1Enabled === true,
      script2Enabled: config.script2Enabled === true,
      script3Enabled: config.script3Enabled === true,
      debugMode: config.debugMode === true,
      scriptTitles: Array.isArray(config.scriptTitles) ? config.scriptTitles : [],
      firstUserDelayScripts: Array.isArray(config.auditDeferArray) ? config.auditDeferArray : [],
      firstUserDelayMs: 12000,
      everyTimeDelayMs: 6000,
      firstUserDelayScriptsEnabled: true,
      adminManaged: false,
    },
    auditStatus: {
      running: false,
      complete: auditComplete,
      failed: false,
      progress: auditComplete ? 100 : 0,
      pageIndex: auditComplete ? 1 : 0,
      totalPages: auditComplete ? 1 : 0,
      phase: null,
      queue: null,
      errorMessage: null,
    },
    version: { configUpdatedAt: store.updatedAt?.toISOString?.() ?? null, scriptHash: null },
  };
}
