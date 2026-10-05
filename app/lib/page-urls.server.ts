/**
 * Validation for the merchant-typed PLP / PDP URLs (Step 1).
 *
 * The audit opens these in a headless browser on our server and appends the
 * storefront password to them, so they must be pages on the merchant's OWN
 * store. Auth/preview params (a pasted share link carries `_bt`, `key`,
 * `preview_theme_id`, …) are stripped — the audit adds what it needs itself.
 */

export type CustomUrlKind = "plp" | "pdp" | "page";

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
  page: "/pages/about",
};
/** Full noun phrase for messages, so the generic kind does not read
 *  "a page page". KIND_LABEL below stays a bare word because the path warning
 *  appends " page" itself (and never fires for the generic kind). */
const KIND_PHRASE: Record<CustomUrlKind, string> = {
  plp: "collection page",
  pdp: "product page",
  page: "page",
};
const KIND_LABEL: Record<CustomUrlKind, string> = {
  plp: "collection",
  pdp: "product",
  page: "page",
};
const PATH_HINT: Record<CustomUrlKind, string> = {
  plp: "/collections/",
  pdp: "/products/",
  // Extras have no known page type, so there is no path to hint at. The
  // path check below is skipped for them (see `kind === "page"`).
  page: "",
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
      error: `That doesn't look like a valid URL. Enter a ${KIND_PHRASE[kind]} on your store, for example ${EXAMPLE[kind]}.`,
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
      error: `That is your homepage. Enter a ${KIND_PHRASE[kind]}, for example ${EXAMPLE[kind]}.`,
    };
  }

  u.protocol = "https:";
  u.username = "";
  u.password = "";
  u.hash = "";
  for (const p of STRIPPED_PARAMS) u.searchParams.delete(p);

  const result: NormalizedCustomUrl = { ok: true, url: u.toString() };
  if (kind !== "page" && !u.pathname.toLowerCase().includes(PATH_HINT[kind])) {
    result.warning = `This doesn't look like a ${label} page (${PATH_HINT[kind]}…). It will be audited as entered.`;
  }
  return result;
}


/**
 * Normalise a LIST of extra pages, keeping one error per index.
 *
 * `normalizeCustomUrl` is single-URL and returns a friendly string, which is
 * wrong for a list: the UI has to say WHICH row is wrong, otherwise a merchant
 * staring at eight identical-looking fields cannot tell which one failed.
 *
 * Blanks are dropped rather than rejected, so a freshly-clicked "+" row that the
 * merchant has not filled in yet does not block saving the rest.
 */
export interface NormalizedUrlList {
  ok: boolean;
  /** Cleaned URLs, blanks removed, in input order. */
  urls: string[];
  /** 1-based row numbers that failed, so the UI can mark the right field. */
  errorRows: number[];
  /** 1-based row -> message. */
  errors: Record<number, string>;
}

export function normalizeCustomUrlList(
  input: unknown,
  shopDomain: string,
): NormalizedUrlList {
  const raw = Array.isArray(input) ? input : input == null ? [] : [input];
  const out: NormalizedUrlList = { ok: true, urls: [], errorRows: [], errors: {} };
  raw.forEach((value, i) => {
    if (String(value ?? "").trim() === "") return; // blank row: skip, not an error
    const r = normalizeCustomUrl(value, shopDomain, "page");
    if (!r.ok) {
      out.ok = false;
      const row = i + 1;
      out.errorRows.push(row);
      out.errors[row] = r.error || "That page could not be used.";
      return;
    }
    // De-duplicate: the same path twice would measure the same page twice and
    // inflate every per-page number in the report.
    if (!out.urls.includes(r.url!)) out.urls.push(r.url!);
  });
  return out;
}
