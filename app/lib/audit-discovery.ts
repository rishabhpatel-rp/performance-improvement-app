/** Pure page-discovery helpers, shared by the audit engine and its tests. */

export interface DiscoveryProduct {
  handle: string;
  onlineStoreUrl?: string | null;
}
export interface DiscoveryData {
  collections?: {
    nodes?: Array<{
      handle: string;
      products?: { nodes?: DiscoveryProduct[] };
    }>;
  };
  products?: { nodes?: DiscoveryProduct[] };
}

/** Picks the PLP / PDP from the discovery query result (pure, unit-testable).
 *  - PLP: the first published collection that has a product on the storefront;
 *    else `/collections/all` (always exists) when the store has any published
 *    product; else none.
 *  - PDP: that collection's best-selling product that is actually on the
 *    storefront (`onlineStoreUrl` set); else the first published product. */
export function pickPagesFromDiscovery(
  data: DiscoveryData,
  shopDomain: string,
): { plp?: string; pdp?: string } {
  const onStorefront = (p: DiscoveryProduct) => Boolean(p.onlineStoreUrl);
  const anyProduct = data.products?.nodes?.[0];
  const collection = (data.collections?.nodes ?? []).find((c) =>
    (c.products?.nodes ?? []).some(onStorefront),
  );

  let plpPath: string | undefined;
  let pdpHandle: string | undefined;
  if (collection) {
    plpPath = `/collections/${collection.handle}`;
    pdpHandle = (collection.products?.nodes ?? []).find(onStorefront)?.handle;
  }
  if (!plpPath && anyProduct) plpPath = "/collections/all";
  if (!pdpHandle && anyProduct?.handle) pdpHandle = anyProduct.handle;

  return {
    plp: plpPath ? `https://${shopDomain}${plpPath}` : undefined,
    pdp: pdpHandle ? `https://${shopDomain}/products/${pdpHandle}` : undefined,
  };
}

const STORE_PLP_SEGMENTS = ["collections", "collection", "shop", "catalog"];
const STORE_PDP_SEGMENTS = ["products", "product"];

export const GENERIC_PLP_SEGMENTS = [
  ...STORE_PLP_SEGMENTS,
  "category",
  "categories",
  "c",
  "products-list",
  "all",
];
export const GENERIC_PDP_SEGMENTS = [...STORE_PDP_SEGMENTS, "p", "item", "produto", "detail"];

function resolveCandidate(raw: unknown, home: string): string | undefined {
  if (typeof raw !== "string" || !raw) return undefined;
  try {
    const url = new URL(raw, home);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    const current = new URL(home);
    if (url.host !== current.host) return undefined;
    if (url.pathname === "/" || url.pathname === "") return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

function segmentsForPath(pathname: string, segments: string[]): boolean {
  return segments.some((segment) => pathname.split("/").includes(segment));
}

/** Fallback 1 (no browser): read collection/product links from the homepage
 * HTML with a plain HTTP request, ~10x faster than launching Chromium. */
export function findPagesInHtml(html: string, home: string): { plp?: string; pdp?: string } {
  const find = (...segments: string[]) => {
    for (const segment of segments) {
      const m = html.match(new RegExp(`href=["']([^"'#?]*/${segment}/[a-z0-9_-][^"'#?]*)`, "i"));
      if (!m) continue;
      try {
        return new URL(m[1], home).toString();
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  return {
    plp: find(...STORE_PLP_SEGMENTS),
    pdp: find(...STORE_PDP_SEGMENTS),
  };
}

/** Generic-site fallback. The installed-store path above keeps its original
 * priority so existing storefront audits are unchanged. */
export function findGenericPagesInHtml(html: string, home: string): { plp?: string; pdp?: string } {
  const found = findPagesInHtml(html, home);
  const find = (...segments: string[]) => {
    for (const segment of segments) {
      const m = html.match(new RegExp(`href=["']([^"'#?]*/${segment}/[a-z0-9_-][^"'#?]*)`, "i"));
      if (!m) continue;
      try {
        return new URL(m[1], home).toString();
      } catch {
        return undefined;
      }
    }
    return undefined;
  };
  return {
    plp: found.plp ?? find(...GENERIC_PLP_SEGMENTS.slice(STORE_PLP_SEGMENTS.length)),
    pdp: found.pdp ?? find(...GENERIC_PDP_SEGMENTS.slice(STORE_PDP_SEGMENTS.length)),
  };
}

function jsonLdObjects(html: string): unknown[] {
  const out: unknown[] = [];
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const block of blocks) {
    try {
      const value = JSON.parse(block[1]);
      const push = (item: unknown) => {
        if (!item || typeof item !== "object") return;
        out.push(item);
        const graph = (item as { "@graph"?: unknown })["@graph"];
        if (Array.isArray(graph)) graph.forEach(push);
      };
      if (Array.isArray(value)) value.forEach(push);
      else push(value);
    } catch {
      /* malformed JSON-LD is ignored */
    }
  }
  return out;
}

function ldTypes(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { "@type"?: unknown })["@type"];
  return Array.isArray(raw) ? raw.map(String) : raw ? [String(raw)] : [];
}

/** Structured-data / canonical signals — highest confidence for generic sites. */
export function findPagesInStructuredData(
  html: string,
  home: string,
): { plp?: string; pdp?: string } {
  let plp: string | undefined;
  let pdp: string | undefined;
  for (const object of jsonLdObjects(html)) {
    const types = ldTypes(object);
    const record = object as Record<string, unknown>;
    const isPlp = types.some((type) => /collectionpage|itemlist|searchresults/i.test(type));
    const isPdp = types.some((type) => /^product$/i.test(type));
    if (!plp && isPlp) {
      const item = Array.isArray(record.itemListElement)
        ? (record.itemListElement[0] as Record<string, unknown> | undefined)
        : undefined;
      plp = resolveCandidate(record.url, home) ?? resolveCandidate(item?.url, home);
    }
    if (!pdp && isPdp) pdp = resolveCandidate(record.url, home);
  }
  if (!plp) {
    const canonical = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"'#?]+)/i);
    plp = resolveCandidate(canonical?.[1], home);
  }
  return { plp, pdp };
}

/** Paths sampled from a sitemap.xml body. */
export function findPagesInSitemap(
  xml: string,
  home: string,
): { plp?: string; pdp?: string; extras: string[] } {
  const extras: string[] = [];
  for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
    const url = resolveCandidate(match[1], home);
    if (!url || extras.includes(url)) continue;
    extras.push(url);
  }
  const find = (segments: string[]) =>
    extras.find((url) => segmentsForPath(new URL(url).pathname, segments));
  return {
    plp: find(GENERIC_PLP_SEGMENTS),
    pdp: find(GENERIC_PDP_SEGMENTS),
    extras,
  };
}
