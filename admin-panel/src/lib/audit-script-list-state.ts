import {
  readStringList,
  scopeListColumn,
  type TemplateScope,
} from "@/lib/storefront-lists";

export type ScriptListState = {
  auditDeferArray: string[];
  firstUserDelayScripts: string[];
  staticDeferDefaults: string[];
};

/** Names on this tab only (dropdown semantics match merchant Step 2). */
export function scriptListStateForTab(
  row: Record<string, unknown> | null | undefined,
  scope: TemplateScope,
): ScriptListState {
  if (!row) {
    return { auditDeferArray: [], firstUserDelayScripts: [], staticDeferDefaults: [] };
  }
  return {
    auditDeferArray: readStringList(row[scopeListColumn("defer", scope)]),
    firstUserDelayScripts: readStringList(row[scopeListColumn("first", scope)]),
    staticDeferDefaults: readStringList(row[scopeListColumn("every", scope)]),
  };
}

export function scriptListStateForScope(
  row: Record<string, unknown> | null | undefined,
  scope: TemplateScope,
): ScriptListState {
  if (!row) {
    return { auditDeferArray: [], firstUserDelayScripts: [], staticDeferDefaults: [] };
  }
  const defer = readStringList(row[scopeListColumn("defer", "global")]);
  const first = readStringList(row[scopeListColumn("first", "global")]);
  const every = readStringList(row[scopeListColumn("every", "global")]);
  if (scope === "global") {
    return {
      auditDeferArray: defer,
      firstUserDelayScripts: first,
      staticDeferDefaults: every,
    };
  }
  const u = <T extends string>(a: T[], b: T[]) => [...new Set([...a, ...b])].sort();
  return {
    auditDeferArray: u(
      defer,
      readStringList(row[scopeListColumn("defer", scope)]),
    ),
    firstUserDelayScripts: u(
      first,
      readStringList(row[scopeListColumn("first", scope)]),
    ),
    staticDeferDefaults: u(
      every,
      readStringList(row[scopeListColumn("every", scope)]),
    ),
  };
}
