import type { TemplateListBuckets } from "./template-script-config.ts";
import { TEMPLATE_SCOPES, unionTemplateLists } from "./template-script-config.ts";

/** Theme-wide classes that must never be hide-gated (lazy-load chrome, etc.). */
const EXACT_UNSAFE_HIDE = new Set([
  ".lazyload",
  ".lazyloaded",
  ".ls-is-cached",
]);

const UNSAFE_HIDE_CLASS_TOKENS = new Set(["lazyload", "lazyloaded", "ls-is-cached"]);

/** Selectors too broad to use as hide rules — they match header/hero media. */
export function isUnsafeHideSelector(selector: string): boolean {
  const s = String(selector || "").trim();
  if (!s) return true;
  if (EXACT_UNSAFE_HIDE.has(s)) return true;
  const singleClass = /^\.([a-zA-Z0-9_-]+)$/.exec(s);
  if (singleClass && UNSAFE_HIDE_CLASS_TOKENS.has(singleClass[1])) return true;
  return false;
}

export function filterUnsafeHideSelectors(selectors: string[]): {
  safe: string[];
  rejected: string[];
} {
  const safe: string[] = [];
  const rejected: string[] = [];
  for (const sel of selectors) {
    if (isUnsafeHideSelector(sel)) rejected.push(sel);
    else safe.push(sel);
  }
  return { safe, rejected };
}

export function applyHideSelectorHygiene(selectors: string[]): {
  hideSelectors: string[];
  warnings: string[];
} {
  const { safe, rejected } = filterUnsafeHideSelectors(selectors);
  return {
    hideSelectors: safe,
    warnings: rejected.map((s) => `unsafe-hide-selector:${s}`),
  };
}

/** Keep template hide columns aligned with the union list written to StoreConfig. */
export function filterHideTemplateBuckets(
  buckets: TemplateListBuckets,
  allowedUnion: string[],
): TemplateListBuckets {
  const allowed = new Set(allowedUnion);
  const out: TemplateListBuckets = {
    global: [],
    home: [],
    collection: [],
    product: [],
  };
  for (const scope of TEMPLATE_SCOPES) {
    out[scope] = buckets[scope].filter((s) => allowed.has(s) && !isUnsafeHideSelector(s));
  }
  return out;
}

export function emptyHideTemplateBuckets(): TemplateListBuckets {
  return { global: [], home: [], collection: [], product: [] };
}

/** Union of hide lists with unsafe selectors removed (storefront + audit save). */
export function sanitizeHideSelectorsForStore(selectors: string[]): string[] {
  return filterUnsafeHideSelectors(selectors).safe;
}

export function sanitizeHideTemplateBuckets(buckets: TemplateListBuckets): TemplateListBuckets {
  const union = sanitizeHideSelectorsForStore(unionTemplateLists(buckets));
  const allowed = new Set(union);
  return filterHideTemplateBuckets(buckets, [...allowed]);
}
