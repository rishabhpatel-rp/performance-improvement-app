/** Home / Collection / Product / Global defer buckets from per-page audit output. */

export type AuditPageRole = "home" | "collection" | "product" | "extra";

export type TemplateDeferBuckets = {
  global: string[];
  home: string[];
  collection: string[];
  product: string[];
};

const TEMPLATE_ROLES: AuditPageRole[] = ["home", "collection", "product"];

function deferTokensForRole(
  deferByPath: Record<string, string[]>,
  pageRoles: Record<string, AuditPageRole>,
  role: AuditPageRole,
): string[] {
  const u = new Set<string>();
  for (const [path, tokens] of Object.entries(deferByPath)) {
    if (pageRoles[path] !== role) continue;
    tokens.forEach((t) => u.add(t));
  }
  return [...u];
}

function intersectSorted(sets: string[][]): string[] {
  if (!sets.length) return [];
  let base = new Set(sets[0]);
  for (const s of sets.slice(1)) {
    const next = new Set(s);
    base = new Set([...base].filter((t) => next.has(t)));
  }
  return [...base].sort();
}

function deltaOnly(full: string[], global: Set<string>): string[] {
  return full.filter((t) => !global.has(t));
}

/**
 * Global = defer on every audited template page (home ∩ collection ∩ product).
 * Home / collection / product = per-template defer minus global.
 * Extra pages are audited separately; they do not change template intersection
 * (see docs/plans/AUDIT-TEMPLATE-BUCKETS-2026-10-13.md).
 */
/** @deprecated name — same logic for hide selectors per template. */
export function buildTemplateListBuckets(
  listByPath: Record<string, string[]>,
  pageRoles: Record<string, AuditPageRole>,
): TemplateDeferBuckets {
  return buildTemplateDeferBuckets(listByPath, pageRoles);
}

export function buildTemplateDeferBuckets(
  deferByPath: Record<string, string[]>,
  pageRoles: Record<string, AuditPageRole>,
): TemplateDeferBuckets {
  const perRole = TEMPLATE_ROLES.map((role) =>
    deferTokensForRole(deferByPath, pageRoles, role),
  );
  const presentTemplates = perRole.filter((s) => s.length > 0);

  const global = intersectSorted(presentTemplates);
  const globalSet = new Set(global);

  const homeUnion = deferTokensForRole(deferByPath, pageRoles, "home");
  const collectionUnion = deferTokensForRole(deferByPath, pageRoles, "collection");
  const productUnion = deferTokensForRole(deferByPath, pageRoles, "product");

  return {
    global,
    home: deltaOnly(homeUnion, globalSet).sort(),
    collection: deltaOnly(collectionUnion, globalSet).sort(),
    product: deltaOnly(productUnion, globalSet).sort(),
  };
}

export function templateDeferToPageVariants(
  buckets: TemplateDeferBuckets,
  hide?: TemplateDeferBuckets,
): Array<{ pattern: string; add: string[]; hide: string[] }> {
  const h = hide ?? { global: [], home: [], collection: [], product: [] };
  return [
    { pattern: "/products/", add: buckets.product, hide: h.product },
    { pattern: "/collections/", add: buckets.collection, hide: h.collection },
    { pattern: "/", add: buckets.home, hide: h.home },
  ];
}
