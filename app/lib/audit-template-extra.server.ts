import { urlToCandidates } from "./audit-candidates";

export { applyExtraPageDeferRules } from "./audit-template-extra";

export function tokensSeenByPathFromResources(
  resourcesByPath: Record<string, Array<{ url: string }>>,
): Record<string, Set<string>> {
  const out: Record<string, Set<string>> = {};
  for (const [path, rows] of Object.entries(resourcesByPath)) {
    const set = new Set<string>();
    const pageUrl = `https://shop.test${path}`;
    for (const row of rows) {
      const b = urlToCandidates(row.url, pageUrl);
      for (const t of [...b.kept, ...b.neverDefer]) set.add(t);
    }
    out[path] = set;
  }
  return out;
}
