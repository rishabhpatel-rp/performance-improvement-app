/**
 * Validation for the merchant-typed PLP / PDP URLs (Step 1).
 *
 * The audit opens these in a headless browser on our server and appends the
 * storefront password to them, so they must be pages on the merchant's OWN
 * store. Auth/preview params (a pasted share link carries `_bt`, `key`,
 * `preview_theme_id`, …) are stripped — the audit adds what it needs itself.
 */

export type CustomUrlKind = "plp" | "pdp";

export interface NormalizedCustomUrl {
  /** false = the input must be rejected (see `error`). Empty input is ok. */
  ok: boolean;
  /** Clean absolute https URL on the store's host; undefined when input is empty. */
  url?: string;
  /** Why the input was rejected. */
  error?: string;
  /** Accepted, but probably not what the merchant meant. */
  warning?: string;
}

// Params that carry credentials / preview state and must never be stored.
const STRIPPED_PARAMS = [
  "_bt",
  "_ab",
  "_fd",
  "_sc",
  "key",
  "preview_theme_id",
  "password",
];

const EXAMPLE: Record<CustomUrlKind, string> = {
  plp: "/collections/all",
  pdp: "/products/your-product",
};
const KIND_LABEL: Record<CustomUrlKind, string> = {
  plp: "collection",
  pdp: "product",
};
const PATH_HINT: Record<CustomUrlKind, string> = {
  plp: "/collections/",
  pdp: "/products/",
};

/**
 * Accepts `https://store.myshopify.com/collections/all`, `store.myshopify.com/collections/all`
 * or just `/collections/all`. Returns a clean URL on `shopDomain`, or an error.
 */
export function normalizeCustomUrl(
  input: unknown,
  shopDomain: string,
  kind: CustomUrlKind,
): NormalizedCustomUrl {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: true };

  const label = KIND_LABEL[kind];
  const shopHost = shopDomain.toLowerCase();

  let u: URL;
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      u = new URL(raw, `https://${shopHost}`);
    } else if (/^https?:\/\//i.test(raw)) {
      u = new URL(raw);
    } else {
      u = new URL(`https://${raw.replace(/^\/+/, "")}`);
    }
  } catch {
    return {
      ok: false,
      error: `That doesn't look like a valid URL. Enter a ${label} page on your store, for example ${EXAMPLE[kind]}.`,
    };
  }

  if (u.hostname.toLowerCase() !== shopHost || u.port) {
    return {
      ok: false,
      error: `Use a page from your own store (${shopHost}). You can also just enter the path, for example ${EXAMPLE[kind]}.`,
    };
  }

  if (u.pathname === "/" || u.pathname === "") {
    return {
      ok: false,
      error: `That is your homepage. Enter a ${label} page, for example ${EXAMPLE[kind]}.`,
    };
  }

  u.protocol = "https:";
  u.username = "";
  u.password = "";
  u.hash = "";
  for (const p of STRIPPED_PARAMS) u.searchParams.delete(p);

  const result: NormalizedCustomUrl = { ok: true, url: u.toString() };
  if (!u.pathname.toLowerCase().includes(PATH_HINT[kind])) {
    result.warning = `This doesn't look like a ${label} page (${PATH_HINT[kind]}…). It will be audited as entered.`;
  }
  return result;
}
