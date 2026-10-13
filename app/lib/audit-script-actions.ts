/** Script-list helpers (client + server). Pure logic in audit-script-actions-pure.ts. */

import type { TemplateListBuckets, TemplateScope } from "./template-script-config";
import {
  auditDeferColumn,
  firstUserDelayColumn,
  readBucketsFromRow,
  staticDeferColumn,
  unionTemplateLists,
} from "./template-script-config";

export type {
  ScriptListState,
  ScriptTokenAction,
} from "./audit-script-actions-pure";

export {
  applyScopedTokenAction,
  buildArrayPatchForTokenAction,
  effectiveListForScope,
  inferScriptActionFromLists,
} from "./audit-script-actions-pure";

import {
  effectiveListForScope,
  type ScriptListState,
} from "./audit-script-actions-pure";

export type ScriptArrayPatch = {
  auditDeferArray?: string[];
  firstUserDelayScripts?: string[];
  staticDeferDefaults?: string[];
};

export function scriptListStateForScope(
  row: Record<string, unknown> | null | undefined,
  scope: TemplateScope,
): ScriptListState {
  const defer = readBucketsFromRow(row, auditDeferColumn, "auditDeferArray");
  const first = readBucketsFromRow(row, firstUserDelayColumn, "firstUserDelayScripts");
  const every = readBucketsFromRow(row, staticDeferColumn, "staticDeferDefaults");
  return {
    auditDeferArray: effectiveListForScope(defer, scope),
    firstUserDelayScripts: effectiveListForScope(first, scope),
    staticDeferDefaults: effectiveListForScope(every, scope),
  };
}

export function storePatchFromTemplateLists(
  defer: TemplateListBuckets,
  hide: TemplateListBuckets,
  first: TemplateListBuckets,
  every: TemplateListBuckets,
): Record<string, string[]> {
  const patch: Record<string, string[]> = {};
  for (const scope of ["global", "home", "collection", "product"] as TemplateScope[]) {
    patch[auditDeferColumn(scope)] = defer[scope];
    patch[firstUserDelayColumn(scope)] = first[scope];
    patch[staticDeferColumn(scope)] = every[scope];
  }
  patch.auditDeferArray = unionTemplateLists(defer);
  patch.auditHideSelectors = unionTemplateLists(hide);
  patch.firstUserDelayScripts = unionTemplateLists(first);
  patch.staticDeferDefaults = unionTemplateLists(every);
  return patch;
}
