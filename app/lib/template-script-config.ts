/** Store + UI keys for Global / Home / Collection / Product script lists. */

export const TEMPLATE_SCOPES = ["global", "home", "collection", "product"] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const TEMPLATE_SCOPE_LABELS: Record<TemplateScope, string> = {
  global: "Global",
  home: "Home",
  collection: "Collection",
  product: "Product",
};

export type TemplateListBuckets = {
  global: string[];
  home: string[];
  collection: string[];
  product: string[];
};

function scopeSuffix(scope: TemplateScope): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export function auditDeferColumn(scope: TemplateScope): string {
  return `auditDefer${scopeSuffix(scope)}`;
}

export function auditHideColumn(scope: TemplateScope): string {
  return `auditHide${scopeSuffix(scope)}`;
}

export function firstUserDelayColumn(scope: TemplateScope): string {
  return `firstUserDelayScripts${scopeSuffix(scope)}`;
}

export function staticDeferColumn(scope: TemplateScope): string {
  return `staticDeferDefaults${scopeSuffix(scope)}`;
}

export function firstUserDelayMsColumn(scope: TemplateScope): string {
  return `firstUserDelayMs${scopeSuffix(scope)}`;
}

export function everyTimeDelayMsColumn(scope: TemplateScope): string {
  return `everyTimeDelayMs${scopeSuffix(scope)}`;
}

export function unionTemplateLists(buckets: TemplateListBuckets): string[] {
  const u = new Set<string>();
  for (const scope of TEMPLATE_SCOPES) {
    buckets[scope].forEach((t) => u.add(t));
  }
  return [...u].sort();
}

export function readBucketsFromRow(
  row: Record<string, unknown> | null | undefined,
  columnFn: (scope: TemplateScope) => string,
  legacyColumn?: string,
): TemplateListBuckets {
  const read = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  const buckets: TemplateListBuckets = {
    global: [],
    home: [],
    collection: [],
    product: [],
  };
  if (!row) return buckets;

  let any = false;
  for (const scope of TEMPLATE_SCOPES) {
    const col = columnFn(scope);
    const arr = read(row[col]);
    buckets[scope] = arr;
    if (arr.length) any = true;
  }
  if (!any && legacyColumn && row[legacyColumn]) {
    buckets.global = read(row[legacyColumn]);
  }
  return buckets;
}

export function templateConfigFromRow(
  sc: Record<string, unknown> | null | undefined,
): Record<string, string[] | number> {
  const out: Record<string, string[] | number> = {};
  if (!sc) return out;
  const read = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  for (const scope of TEMPLATE_SCOPES) {
    out[auditDeferColumn(scope)] = read(sc[auditDeferColumn(scope)]);
    out[auditHideColumn(scope)] = read(sc[auditHideColumn(scope)]);
    out[firstUserDelayColumn(scope)] = read(sc[firstUserDelayColumn(scope)]);
    out[staticDeferColumn(scope)] = read(sc[staticDeferColumn(scope)]);
    const fms = sc[firstUserDelayMsColumn(scope)];
    out[firstUserDelayMsColumn(scope)] =
      typeof fms === "number" && !Number.isNaN(fms) ? fms : 12000;
    const ems = sc[everyTimeDelayMsColumn(scope)];
    out[everyTimeDelayMsColumn(scope)] =
      typeof ems === "number" && !Number.isNaN(ems) ? ems : 6000;
  }
  return out;
}

export function templateListFormKeys(): string[] {
  const keys: string[] = [];
  for (const scope of TEMPLATE_SCOPES) {
    keys.push(
      auditDeferColumn(scope),
      auditHideColumn(scope),
      firstUserDelayColumn(scope),
      staticDeferColumn(scope),
    );
  }
  return keys;
}

export function templateDelayFormKeys(): string[] {
  return TEMPLATE_SCOPES.flatMap((scope) => [
    firstUserDelayMsColumn(scope),
    everyTimeDelayMsColumn(scope),
  ]);
}

export function templateBucketsToStorePatch(
  defer: TemplateListBuckets,
  hide: TemplateListBuckets,
): Record<string, string[]> {
  const patch: Record<string, string[]> = {};
  for (const scope of TEMPLATE_SCOPES) {
    patch[auditDeferColumn(scope)] = defer[scope];
    patch[auditHideColumn(scope)] = hide[scope];
  }
  patch.auditDeferArray = unionTemplateLists(defer);
  patch.auditHideSelectors = unionTemplateLists(hide);
  return patch;
}
