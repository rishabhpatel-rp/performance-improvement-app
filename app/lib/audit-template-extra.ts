/** Extra-page defer rules — no relative imports (node --test). */

export type TemplateListBuckets = {
  global: string[];
  home: string[];
  collection: string[];
  product: string[];
};

/** Extra audit URLs: add extra-only defers to global; veto global if seen on extra but not deferred there. */
export function applyExtraPageDeferRules(
  buckets: TemplateListBuckets,
  deferByPath: Record<string, string[]>,
  pageRoles: Record<string, string>,
  seenByPath: Record<string, Set<string>>,
): TemplateListBuckets {
  const extraPaths = Object.entries(pageRoles)
    .filter(([, role]) => role === "extra")
    .map(([path]) => path);
  if (!extraPaths.length) return buckets;

  const global = new Set(buckets.global);
  const onTemplates = new Set([
    ...buckets.global,
    ...buckets.home,
    ...buckets.collection,
    ...buckets.product,
  ]);

  for (const path of extraPaths) {
    for (const token of deferByPath[path] || []) {
      if (!onTemplates.has(token)) global.add(token);
    }
  }

  for (const token of [...global]) {
    for (const path of extraPaths) {
      const seen = seenByPath[path]?.has(token);
      if (!seen) continue;
      if (!(deferByPath[path] || []).includes(token)) {
        global.delete(token);
        break;
      }
    }
  }

  return { ...buckets, global: [...global].sort() };
}
