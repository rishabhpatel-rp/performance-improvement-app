/** Pure script-list helpers — no relative imports (node --test can load this file). */

export type ScriptTokenAction =
  | "keep"
  | "defer"
  | "delay_first"
  | "delay_every"
  | "protected";

export type ScriptListState = {
  auditDeferArray: string[];
  firstUserDelayScripts: string[];
  staticDeferDefaults: string[];
};

import type {
  TemplateListBuckets,
  TemplateScope,
} from "./template-script-config";

export type { TemplateListBuckets, TemplateScope };

function without(list: string[], token: string) {
  return list.filter((t) => t !== token);
}

function withToken(list: string[], token: string) {
  if (!token || list.includes(token)) return [...list];
  return [...list, token].sort();
}

export function buildArrayPatchForTokenAction(
  current: ScriptListState,
  token: string,
  action: ScriptTokenAction,
): Partial<ScriptListState> | null {
  const t = String(token).trim();
  if (!t || action === "keep") return null;

  let defer = [...current.auditDeferArray];
  let first = [...current.firstUserDelayScripts];
  let every = [...current.staticDeferDefaults];

  defer = without(defer, t);
  first = without(first, t);
  every = without(every, t);

  switch (action) {
    case "defer":
      defer = withToken(defer, t);
      break;
    case "delay_first":
      first = withToken(first, t);
      break;
    case "delay_every":
      every = withToken(every, t);
      break;
    case "protected":
      break;
    default:
      return null;
  }

  return {
    auditDeferArray: defer,
    firstUserDelayScripts: first,
    staticDeferDefaults: every,
  };
}

export function inferScriptActionFromLists(
  lists: ScriptListState,
  token: string,
  auditStatus: string,
): ScriptTokenAction {
  const t = String(token).trim();
  if (lists.auditDeferArray.includes(t)) return "defer";
  if (lists.firstUserDelayScripts.includes(t)) return "delay_first";
  if (lists.staticDeferDefaults.includes(t)) return "delay_every";
  if (auditStatus === "deferred") return "defer";
  if (auditStatus === "never" || auditStatus === "protected") return "protected";
  return "keep";
}

export function effectiveListForScope(
  buckets: TemplateListBuckets,
  scope: TemplateScope,
): string[] {
  if (scope === "global") return [...buckets.global];
  const u = new Set([...buckets.global, ...buckets[scope]]);
  return [...u].sort();
}

export function applyScopedTokenAction(
  defer: TemplateListBuckets,
  first: TemplateListBuckets,
  every: TemplateListBuckets,
  scope: TemplateScope,
  token: string,
  action: ScriptTokenAction,
): {
  defer: TemplateListBuckets;
  first: TemplateListBuckets;
  every: TemplateListBuckets;
} | null {
  const slice: ScriptListState = {
    auditDeferArray: [...defer[scope]],
    firstUserDelayScripts: [...first[scope]],
    staticDeferDefaults: [...every[scope]],
  };
  const patch = buildArrayPatchForTokenAction(slice, token, action);
  if (!patch) return null;
  return {
    defer: {
      ...defer,
      [scope]: patch.auditDeferArray ?? defer[scope],
    },
    first: {
      ...first,
      [scope]: patch.firstUserDelayScripts ?? first[scope],
    },
    every: {
      ...every,
      [scope]: patch.staticDeferDefaults ?? every[scope],
    },
  };
}
