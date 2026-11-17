import { readStringArray } from "./performance-script.server";
import { templateConfigFromRow } from "./template-script-config";

const DEFAULT_STATIC_DEFER = ["wpm", "gtm"];

type StoreConfigRow = Record<string, unknown>;

/** Step 2 config shape — same fields merchants see in Step3Titles / scan table. */
export function buildStep2Config(sc: StoreConfigRow | null | undefined) {
  const auditHasRun = Boolean(sc?.lastAuditAt);
  let auditDeferArray = readStringArray(sc?.auditDeferArray);
  let auditHideSelectors = readStringArray(sc?.auditHideSelectors);
  let staticDeferDefaults = [...DEFAULT_STATIC_DEFER];

  if (sc) {
    const dbDefer = readStringArray(sc.auditDeferArray);
    const dbHide = readStringArray(sc.auditHideSelectors);
    const dbStatic = readStringArray(sc.staticDeferDefaults);
    if (auditHasRun || dbDefer.length) auditDeferArray = dbDefer;
    if (auditHasRun || dbHide.length) auditHideSelectors = dbHide;
    staticDeferDefaults = dbStatic.length > 0 ? dbStatic : staticDeferDefaults;
  }

  const firstUser = readStringArray(sc?.firstUserDelayScripts);
  const firstUserDelayScripts = firstUser.length ? firstUser : ["wpm", "gtm"];
  const firstPreserved = readStringArray(sc?.firstUserDelayScriptsPreserved);

  return {
    appEnabled: sc?.appEnabled === true,
    script1Enabled: sc?.script1Enabled === true,
    script2Enabled: sc?.script2Enabled === true,
    script3Enabled: sc?.script3Enabled === true,
    scriptTitles: Array.isArray(sc?.scriptTitles) ? sc.scriptTitles : [],
    debugMode: sc?.debugMode === true,
    auditDeferArray,
    auditHideSelectors,
    staticDeferDefaults,
    auditDeferArrayEnabled: sc?.auditDeferArrayEnabled ?? true,
    auditHideSelectorsEnabled: sc?.auditHideSelectorsEnabled ?? true,
    staticDeferDefaultsEnabled: sc?.staticDeferDefaultsEnabled ?? true,
    firstUserDelayScriptsEnabled: sc?.firstUserDelayScriptsEnabled ?? true,
    auditDeferArrayPreserved: readStringArray(sc?.auditDeferArrayPreserved),
    auditHideSelectorsPreserved: readStringArray(sc?.auditHideSelectorsPreserved),
    staticDeferDefaultsPreserved: readStringArray(sc?.staticDeferDefaultsPreserved),
    firstUserDelayScriptsPreserved: firstPreserved.length ? firstPreserved : [],
    firstUserDelayScripts,
    firstUserDelayMs: typeof sc?.firstUserDelayMs === "number" ? sc.firstUserDelayMs : 12000,
    everyTimeDelayMs: typeof sc?.everyTimeDelayMs === "number" ? sc.everyTimeDelayMs : 6000,
    auditComplete: sc?.auditComplete === true,
    adminManaged: sc?.adminManaged === true,
    ...templateConfigFromRow(sc),
  };
}

export function buildStep2Version(
  store: { isActive: boolean } | null | undefined,
  sc: { updatedAt?: Date; appEnabled?: boolean } | null | undefined,
  ps: { scriptHash?: string | null; metafieldSyncedAt?: Date | null } | null | undefined,
) {
  return {
    configUpdatedAt: sc?.updatedAt?.toISOString?.() ?? null,
    scriptHash: ps?.scriptHash ?? null,
    metafieldSyncedAt: ps?.metafieldSyncedAt?.toISOString?.() ?? null,
    appEnabled: sc?.appEnabled === true,
    isActive: store?.isActive === true,
  };
}
