/**
 * Pure updates for the Global / Home / PLP / PDP lists.
 * The database write and the script rebuild live in store-sync-audit.server.ts.
 */

export type TemplateScope = "global" | "home" | "collection" | "product";

const TEMPLATE_SCOPES: TemplateScope[] = ["global", "home", "collection", "product"];

type TemplateListBuckets = {
  global: string[];
  home: string[];
  collection: string[];
  product: string[];
};

function unionTemplateLists(buckets: TemplateListBuckets): string[] {
  const u = new Set<string>();
  for (const scope of TEMPLATE_SCOPES) {
    buckets[scope].forEach((token) => u.add(token));
  }
  return [...u].sort();
}

export type ListFamily = "defer" | "hide" | "first" | "every";

export const FAMILY_FIELD: Record<ListFamily, string> = {
  defer: "auditDeferArray",
  hide: "auditHideSelectors",
  first: "firstUserDelayScripts",
  every: "staticDeferDefaults",
};

const PRESERVED_FIELD: Record<ListFamily, string> = {
  defer: "auditDeferArrayPreserved",
  hide: "auditHideSelectorsPreserved",
  first: "firstUserDelayScriptsPreserved",
  every: "staticDeferDefaultsPreserved",
};

const ENABLED_FIELD: Record<ListFamily, string> = {
  defer: "auditDeferArrayEnabled",
  hide: "auditHideSelectorsEnabled",
  first: "firstUserDelayScriptsEnabled",
  every: "staticDeferDefaultsEnabled",
};

export function familyFromField(field: string): ListFamily | null {
  const hit = (Object.entries(FAMILY_FIELD) as Array<[ListFamily, string]>).find(
    ([, name]) => name === field,
  );
  return hit ? hit[0] : null;
}

export function isTemplateScope(value: string): value is TemplateScope {
  return (TEMPLATE_SCOPES as readonly string[]).includes(value);
}

function suffix(scope: TemplateScope): string {
  return scope.charAt(0).toUpperCase() + scope.slice(1);
}

export function scopeListColumn(family: ListFamily, scope: TemplateScope): string {
  if (family === "defer") return `auditDefer${suffix(scope)}`;
  if (family === "hide") return `auditHide${suffix(scope)}`;
  if (family === "first") return `firstUserDelayScripts${suffix(scope)}`;
  return `staticDeferDefaults${suffix(scope)}`;
}

export function scopeMsColumn(kind: "first" | "every", scope: TemplateScope): string {
  return kind === "first"
    ? `firstUserDelayMs${suffix(scope)}`
    : `everyTimeDelayMs${suffix(scope)}`;
}

export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

function bucketsFromRow(
  row: Record<string, unknown>,
  family: ListFamily,
): TemplateListBuckets {
  return {
    global: readStringList(row[scopeListColumn(family, "global")]),
    home: readStringList(row[scopeListColumn(family, "home")]),
    collection: readStringList(row[scopeListColumn(family, "collection")]),
    product: readStringList(row[scopeListColumn(family, "product")]),
  };
}

export type ScopeListPatch = {
  defer?: string[];
  hide?: string[];
  first?: string[];
  every?: string[];
  firstMs?: number;
  everyMs?: number;
};

function familyEnabled(row: Record<string, unknown>, family: ListFamily): boolean {
  const flag = row[ENABLED_FIELD[family]];
  return flag !== false;
}

/**
 * Column patch for one tab. Recomputes the four union columns from the
 * scope columns after the patch is applied. Does not touch other tabs.
 */
export function applyScopePatch(
  row: Record<string, unknown>,
  scope: TemplateScope,
  patch: ScopeListPatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  const lists: Array<[ListFamily, string[] | undefined]> = [
    ["defer", patch.defer],
    ["hide", patch.hide],
    ["first", patch.first],
    ["every", patch.every],
  ];
  for (const [family, value] of lists) {
    if (!value) continue;
    next[scopeListColumn(family, scope)] = familyEnabled(row, family) ? value : [];
  }
  if (patch.firstMs != null) {
    next[scopeMsColumn("first", scope)] = patch.firstMs;
    if (scope === "global") next.firstUserDelayMs = patch.firstMs;
  }
  if (patch.everyMs != null) {
    next[scopeMsColumn("every", scope)] = patch.everyMs;
    if (scope === "global") next.everyTimeDelayMs = patch.everyMs;
  }

  const merged = { ...row, ...next };
  (["defer", "hide", "first", "every"] as ListFamily[]).forEach((family) => {
    next[FAMILY_FIELD[family]] = unionTemplateLists(bucketsFromRow(merged, family));
  });
  return next;
}

/** Switch off stores the four scopes and clears them. Switch on writes them back. */
export function toggleFamilyPatch(
  row: Record<string, unknown>,
  family: ListFamily,
  enabled: boolean,
): Record<string, unknown> {
  const preservedKey = PRESERVED_FIELD[family];
  const enabledKey = ENABLED_FIELD[family];
  if (!enabled) {
    const snap = bucketsFromRow(row, family);
    const next: Record<string, unknown> = {
      [preservedKey]: snap,
      [enabledKey]: false,
      [FAMILY_FIELD[family]]: [],
    };
    for (const scope of TEMPLATE_SCOPES) {
      next[scopeListColumn(family, scope)] = [];
    }
    return next;
  }

  const raw = row[preservedKey];
  const restored: TemplateListBuckets = {
    global: [],
    home: [],
    collection: [],
    product: [],
  };
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    for (const scope of TEMPLATE_SCOPES) {
      restored[scope] = readStringList(obj[scope]);
    }
  } else {
    restored.global = readStringList(raw);
  }
  const next: Record<string, unknown> = {
    [enabledKey]: true,
    [FAMILY_FIELD[family]]: unionTemplateLists(restored),
  };
  for (const scope of TEMPLATE_SCOPES) {
    next[scopeListColumn(family, scope)] = restored[scope];
  }
  return next;
}
