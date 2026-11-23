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
    plp: find("collections", "collection", "shop", "catalog"),
    pdp: find("products", "product"),
  };
}
