/**
 * The audit's candidate rules — the single source of truth.
 *
 * This module deliberately has **no relative imports** so `node --test` can
 * import it directly (the rest of `audit.server.ts` uses extensionless imports
 * that only a bundler resolves). It holds the pure classification logic that
 * both the server and the injected in-page script must agree on.
 *
 * The in-page copy lives in the minified `AUDIT_SCRIPT` string in
 * `audit-script.ts`. That duplication is unavoidable — the in-page code has to
 * run inside the browser and cannot import anything — so it is enforced by
 * `Test Data/audit-candidates.test.js`, which runs the real `AUDIT_SCRIPT` in
 * Chromium and asserts it produces identical buckets to the functions here.
 *
 * If you change a rule in this file, change it there too.
 */

/** Hosts that serve the merchant's own storefront/theme assets. A script on
 *  one of these is recorded by filename rather than as a third-party domain.
 *  Exact string match only — `monorail-edge.shopifysvc.com` is deliberately not
 *  listed and is therefore treated as third-party. */
export const P_EXCLUDED_HOSTS = new Set([
  "cdn.shopify.com",
  "shop.app",
  "checkout.shopify.com",
  "cdn.shopifycloud.com",
]);

/** Basenames starting with any of these are Shopify-critical bundles that must
 *  never be deferred. They used to be deleted outright by `passesPFilter`,
 *  which threw away ~39 real scripts per page on a measured store (the whole
 *  ShopLogin chunk set). They now land in a separate `neverDefer` list so the
 *  report stays truthful without ever gating them. */
export const NEVER_DEFER_PREFIXES = ["chunk."];
export const NEVER_DEFER_SUBSTRINGS = ["storefront"];

/** Parent directory that identifies a token as the MERCHANT'S OWN THEME ASSET.
 *
 *  Shopify serves theme files from `/cdn/shop/t/<theme_id>/assets/<name>.js`,
 *  which `tokenForPath` renders as `assets/<name>.js`. App files come from
 *  `/cdn/shop/files/...` -> `files/<name>.js`, and third-party scripts keep
 *  their own directory, so the parent directory alone is a reliable
 *  discriminator.
 *
 *  These are excluded permanently. The double-execution defect in §3.0 of the
 *  redesign plan threw 14 `Identifier 'X' has already been declared` errors and
 *  every one of them was a theme-owned file. Deferring the theme's own JS risks
 *  breaking the merchant's storefront, and no measurement has ever shown a
 *  benefit for doing it — the gate can only hold the ~2–4% tail that is still
 *  pending at install time, which is a poor trade for a broken store.
 *
 *  A third-party script served from a directory literally named `assets` is
 *  also excluded. That is the conservative direction: it can only ever defer
 *  less. */
export const THEME_OWNED_DIRS = ["assets"];


/** Genuine noise only. Kept deliberately narrow: these used to be broad
 *  substrings that also killed `storefront` and `chunk`. */
export const NOISE_SUBSTRINGS = ["www."];
export const MAX_DIGITS = 5;

/** Paths served by this app or by Shopify's own preview tooling. The audit
 *  runs inside the store, so it sees these load like any other script — without
 *  this the app proposes deferring the very script that performs the deferring
 *  (measured: `/apps/performance-scripts` was requested twice per page load).
 *  Matched by path so it works in every environment (tunnel or production)
 *  without hardcoding a host. */
export const SELF_SCRIPT_PATTERNS = [
  /^\/apps\/performance-scripts$/,
  /perf-kit/i,
  /preview-bar-modules/i,
  /web-pixel-/i,
];

export function isSelfScriptPath(pathname: string): boolean {
  return SELF_SCRIPT_PATTERNS.some((re) => re.test(pathname));
}

export type CandidateClass = "kept" | "never-defer" | "noise";

export interface CandidateBuckets {
  kept: string[];
  neverDefer: string[];
  noise: string[];
  self: string[];
}

/**
 * Classify one candidate token.
 *
 * The two-part check matters: the `chunk.` / `storefront` / digit rules inspect
 * the **basename**, while `www.` inspects the **whole token**. A token is
 * `<parentDir>/<basename>`, so a `chunk.` prefix check against the token would
 * never fire for `files/chunk.a.js` — that bug was caught by
 * `Test Data/audit-candidates.test.js`.
 */
export function classifyCandidate(token: string): CandidateClass {
  const a = String(token).toLowerCase();
  const base = a.split("/").pop() || a;
  const stem = base.replace(/\.(min\.)?(js|mjs)$/i, "");
  if (
    NEVER_DEFER_PREFIXES.some((p) => stem.indexOf(p) === 0) ||
    NEVER_DEFER_SUBSTRINGS.some((s) => stem.indexOf(s) !== -1)
  ) {
    return "never-defer";
  }
  // Theme-owned JS is never deferred (D4). Matched on the token's parent
  // directory rather than on the stem, because the stem is only the basename
  // and carries no directory information.
  //
  // A prefix test, not equality: some themes nest their JS (`assets/js/x.js`),
  // and that must be excluded too. Matching on the BASE NAME instead would
  // over-reach — `files/theme.js` is an ordinary app file, not a theme asset.
  const parentDir = a.includes("/") ? a.slice(0, a.lastIndexOf("/")) : "";
  for (const d of THEME_OWNED_DIRS) {
    if (parentDir === d || parentDir.startsWith(d + "/")) return "never-defer";
  }
  if (/^\d+$/.test(stem)) return "noise";
  if ((stem.match(/\d/g) || []).length > MAX_DIGITS) return "noise";
  if (NOISE_SUBSTRINGS.some((s) => a.indexOf(s) !== -1)) return "noise";
  return "kept";
}

/**
 * Emit `<parentDir>/<basename>` rather than a bare basename.
 *
 * The storefront consumer regex-matches these tokens as substrings against the
 * whole script URL, so a bare basename is far too greedy: `anima` also matched
 * `animation-helper.js` and, if the shop slug contained "anima", every script
 * on `acme-animations.myshopify.com`. Qualifying by parent directory is still a
 * real substring of the URL (`.../files/anima.js`) but does not match those.
 */
export function tokenForPath(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const base = parts.pop();
  if (!base) return "";
  const dir = parts.length ? parts[parts.length - 1] + "/" : "";
  return dir + decodeURIComponent(base);
}

export function isThirdPartyHost(host: string, ownHostname: string): boolean {
  const h = host.toLowerCase();
  if (!h) return false;
  if (h === ownHostname || P_EXCLUDED_HOSTS.has(h)) return false;
  if (h.endsWith("." + ownHostname)) return false;
  return true;
}

export function emptyBuckets(): CandidateBuckets {
  return { kept: [], neverDefer: [], noise: [], self: [] };
}

/**
 * Turn one script URL into every candidate token it contributes, bucketed.
 *
 * Mirrors in-page `auditPDetail()`. A script URL yields its path token always,
 * plus its bare hostname when the host is third-party (so all scripts on one
 * third-party domain collapse into a single deferrable entry).
 */
export function urlToCandidates(rawUrl: string, pageUrl: string): CandidateBuckets {
  const kept = new Set<string>();
  const neverDefer = new Set<string>();
  const noise = new Set<string>();
  const self = new Set<string>();
  const put = (map: Set<string>, token: string) => {
    const t = String(token).trim();
    if (t) map.add(t);
  };
  const emit = (raw: string, bucket: CandidateClass) =>
    put(
      bucket === "never-defer" ? neverDefer : bucket === "noise" ? noise : kept,
      raw,
    );

  let ownHostname = "";
  try {
    ownHostname = new URL(pageUrl).hostname.toLowerCase();
  } catch {
    return emptyBuckets();
  }

  let u: URL;
  try {
    u = new URL(rawUrl, pageUrl);
  } catch {
    return emptyBuckets();
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return emptyBuckets();
  if (isSelfScriptPath(u.pathname)) {
    put(self, tokenForPath(u.pathname));
    return { kept: [], neverDefer: [], noise: [], self: [...self] };
  }

  u.hash = "";
  u.search = "";
  const token = tokenForPath(u.pathname);
  if (token) emit(token, classifyCandidate(token));

  const host = u.hostname.toLowerCase();
  if (isThirdPartyHost(host, ownHostname)) emit(host, classifyCandidate(host));

  return {
    kept: [...kept],
    neverDefer: [...neverDefer],
    noise: [...noise],
    self: [...self],
  };
}

// ---------------------------------------------------------------------------
// Coverage verdict
// ---------------------------------------------------------------------------

/** What the V8 Coverage API can tell us about one script.
 *
 * Deliberately the loose structural shape rather than Playwright's
 * `CoverageScriptResult`, so this stays importable without Playwright. */
export interface CoverageEntry {
  functions?: Array<{
    functionName?: string;
    isBlockCoverage?: boolean;
    ranges?: Array<{ count?: number }>;
  }>;
}

export type CoverageVerdict = "ran" | "unknown" | "idle";

/**
 * Decide whether a script ran anything that matters before first interaction.
 *
 * The naive test — "does any function have a range with count > 0" — is always
 * true for a loaded script, because the whole-file block-coverage entry counts
 * as an executed function. Testing only *named* functions is the opposite
 * error: a purely top-level script (a custom-element definition, an IIFE that
 * wires behaviour immediately) does real work while exposing no named
 * function, so it would be wrongly deferred.
 *
 * So coverage genuinely has three answers, and "no named function at all" has
 * to be reported as `unknown` — which callers must treat as *protect*.
 */
export function coverageVerdict(entry: CoverageEntry): CoverageVerdict {
  const functions = entry.functions || [];
  const named = functions.filter(
    (fn) => !fn.isBlockCoverage && fn.functionName !== "" && fn.functionName !== undefined,
  );
  const anyExecuted = functions.some((fn) =>
    (fn.ranges || []).some((r) => (r.count || 0) > 0),
  );
  if (named.length === 0) return anyExecuted ? "unknown" : "idle";
  return named.some((fn) => (fn.ranges || []).some((r) => (r.count || 0) > 0))
    ? "ran"
    : "idle";
}

// ---------------------------------------------------------------------------
// Page matching
// ---------------------------------------------------------------------------

/** Path prefixes that are a locale root or a known non-page path. Used to strip
 *  a locale segment (`/en/collections/all` -> `/collections/all`) so a
 *  locale-prefixed storefront resolves to the same page variant. */
const LOCALE_SEGMENT = /^[a-z]{2}(-[a-z]{2})?$/i;

/**
 * Ordered match patterns for one audited page.
 *
 * The storefront consumer receives one bundle for the whole store and resolves
 * which page it is on at runtime from `location.pathname`. The audit only ever
 * sees three concrete URLs, but a real storefront serves thousands of PDPs, so
 * the emitted patterns must generalise:
 *
 *   /products/gift-card  ->  ["/products/gift-card", "/products/"]
 *   /collections/all     ->  ["/collections/all", "/collections/"]
 *   /                     ->  ["/", ""]
 *
 * The first entry is the exact audited path (most specific wins); the trailing
 * entry is the section prefix that generalises to sibling pages. The locale
 * variants are inserted after the exact path so an exact match always beats a
 * locale match.
 */
export function pageMatchPatterns(pathname: string): string[] {
  let path = pathname || "/";
  if (!path.startsWith("/")) path = "/" + path;
  // Drop query/hash defensively; the consumer compares against location.pathname.
  path = path.split("#")[0].split("?")[0];

  const out: string[] = [path];

  // Locale-stripped variant: /en/collections/all -> /collections/all
  const segments = path.split("/").filter(Boolean);
  const isLocalePrefixed = segments.length > 0 && LOCALE_SEGMENT.test(segments[0]);
  const bare = isLocalePrefixed ? segments.slice(1) : segments;
  if (isLocalePrefixed && bare.length) {
    const stripped = "/" + bare.join("/");
    if (!out.includes(stripped)) out.push(stripped);
  }

  // Section prefix from the locale-stripped segments, so `/en/collections/all`
  // generalises to `/collections/` and never to `/en/`.
  if (bare.length >= 2) {
    const prefix = "/" + bare[0] + "/";
    if (!out.includes(prefix)) out.push(prefix);
  }

  // `/` is its own catch-all and must sort last.
  if (!out.includes("/")) out.push("/");
  return out;
}

// ---------------------------------------------------------------------------
// Slug normalisation (cross-page, not per-name)
// ---------------------------------------------------------------------------

/**
 * The "stem" of a token: the name with a trailing build hash removed. Used only
 * to GROUP tokens that are the same script under different hashes — it is a
 * grouping key, not an emit format.
 *
 * A trailing run counts as a build hash when it is ≥5 chars and either contains
 * a digit or is entirely upper-case. That second condition matters: real
 * Shopify/framework bundles emit base64-ish hashes such as `store-BTEJUR` that
 * contain no digits at all, and a digit-only rule silently failed to group them.
 * Lower-case descriptive tails (`cart-disclosure-modal`) are correctly left
 * alone, because they are not upper-case and contain no digits.
 */
export function tokenStem(token: string): string {
  const base = token.split("/").pop() || token;
  const stem = base.replace(/\.(min\.)?(esm|js|mjs)$/i, "").replace(/\.esm$/i, "");
  const separated = stem.match(/^(.*[._-])([A-Za-z0-9_-]{5,})$/);
  if (separated) {
    const tail = separated[2];
    if (/\d/.test(tail) || /^[A-Z0-9]+$/.test(tail)) {
      return separated[1].replace(/[._-]+$/, "");
    }
  }
  const appended = stem.match(/^(.*?[a-z])([A-Z0-9]{4,})$/);
  if (appended) return appended[1];
  const appendedDigits = stem.match(/^(.*?[A-Za-z])([0-9][0-9a-z]{3,})$/);
  if (appendedDigits) return appendedDigits[1];
  return stem;
}

/**
 * Merge tokens that are the same script under different build hashes.
 *
 * Per the agreed rule: when every page reports the same name it is emitted
 * unchanged (no merge). Only genuinely divergent names are unified, and then by
 * the longest common prefix of the differing part:
 *
 *   store-BTEJUR.js store-BTEJKB.js store-BTERHTG.js  ->  store-BTE
 *   anima095he.js  anima893ju.js   anima345hy.js     ->  anima
 *
 * Merging never loses a script, it only unifies tokens. A hash set with no
 * common prefix stays separate, which is safe (slightly less dedupe).
 */
export function mergeSlugVariants(tokens: string[]): string[] {
  const groups = new Map<string, string[]>();
  for (const t of tokens) {
    const key = tokenStem(t);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(t);
  }
  const out: string[] = [];
  for (const variants of groups.values()) {
    if (variants.length === 1) {
      out.push(variants[0]);
      continue;
    }
    // Longest common prefix of the full tokens, then trim back to a safe
    // character boundary so the result is a prefix of every variant.
    let prefix = variants[0];
    for (const v of variants.slice(1)) {
      let i = 0;
      while (i < prefix.length && i < v.length && prefix[i] === v[i]) i++;
      prefix = prefix.slice(0, i);
    }
    // Trim trailing separators/hash fragments: keep only complete name parts.
    const trimmed = prefix.replace(/[._-]+$/, "");
    out.push(trimmed.length >= 3 ? trimmed : variants.sort()[0]);
  }
  return out;
}
