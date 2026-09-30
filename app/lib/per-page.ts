/**
 * Per-page defer-list selection — pure, no database, no Shopify.
 *
 * Kept out of `performance-script.server.ts` deliberately: that module imports
 * `db.server`, which cannot be resolved by node's ESM loader, so nothing in the
 * test suite can import it. Everything here is a pure function over plain data
 * and is tested directly.
 */

export interface PerPageVariant {
  pattern: string;
  add: string[];
  hide: string[];
}

/**
 * Minimum per-page script delta that justifies shipping a variant.
 *
 * Every variant a bundle carries is paid for on EVERY page load, so a variant
 * holding one or two extra tokens can cost more in payload than it saves in
 * gating. Not configurable per store, because a store-specific threshold would
 * make emitted bundles non-comparable across stores.
 */
export const MIN_PER_PAGE_DELTA = 3;

/**
 * Drop per-page variants whose script delta is too small to be worth their
 * bytes. Hides are exempt: page-specific hide selectors are value the union
 * cannot express, and they are not part of the per-page script payload.
 *
 * A dropped prefix is not a behaviour regression — the page simply falls through
 * to the union, which is a superset of what it would have gated.
 */
export function selectPerPageVariants<T extends PerPageVariant>(candidates: T[]): T[] {
  return candidates.filter((v) => v.add.length >= MIN_PER_PAGE_DELTA || v.hide.length > 0);
}

/**
 * Order page patterns so the most specific prefix is tested first and the "/"
 * catch-all is tested last.
 *
 * "/" must never sort first: it is one character long, so a plain length sort
 * puts it ahead of every real prefix and every page would silently fall back to
 * the union instead of matching its own variant.
 */
export function orderPagePatterns(patterns: string[]): string[] {
  const unique: string[] = [];
  for (const p of patterns) {
    if (typeof p !== "string") continue;
    // Only section prefixes (trailing slash) are meaningful; a bare path like
    // "/products/gift-card" would make sibling pages behave differently from the
    // page that was actually audited.
    if (p.charAt(p.length - 1) !== "/") continue;
    if (!unique.includes(p)) unique.push(p);
  }
  const catchAll = unique.filter((p) => p === "/");
  const prefixes = unique.filter((p) => p !== "/").sort((a, b) => b.length - a.length);
  return prefixes.concat(catchAll);
}
