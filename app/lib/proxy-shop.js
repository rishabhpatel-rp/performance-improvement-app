// Decides which shop an App Proxy request is allowed to read data for.
//
// SECURITY: a `shop` query param is only trustworthy once the App Proxy
// signature over it has been verified. Trusting it unsigned let anyone fetch
// any shop's compiled storefront script by guessing its domain (audit finding
// H2, REMEDIATION Task 2).
//
// Two ways to establish that trust, in order of cost:
//
//   1. verifyAppProxyShop() — verify the signature in-process. No database, no
//      session, no Shopify API call. This is what the storefront script route
//      uses, because that route runs on EVERY page load for EVERY shopper and
//      `authenticate.public.appProxy` loads the offline session, which triggers
//      an OAuth token refresh roughly hourly on a shopper request path (B3 in
//      ARCHITECTURE_AND_DECISIONS.md §4 B3).
//
//   2. resolveVerifiedProxyShop() — read `shop` off an already-authenticated
//      context. Correct, but pays the session lookup. Used as the fallback when
//      (1) declines, so a canonicalisation change in Shopify can never break
//      the storefront.
//
// WHY THE FAST PATH IS SAFE TO FALL BACK FROM
// Any disagreement between our canonicalisation and Shopify's produces a FALSE
// NEGATIVE — the HMAC simply does not match, so we return null and the caller
// uses the library path. For a false positive the attacker would need a
// signature that validates against a string we build differently from Shopify's,
// which requires knowing the shared secret. Missing/blank secrets are refused
// outright rather than skipped.
import { createHmac, timingSafeEqual } from "node:crypto";

// Mirrors @shopify/shopify-api's `stringifyQueryForAppProxy`: keys sorted
// ascending, values joined with `,` for arrays, and the pairs concatenated with
// NO separator (not `&`).
export function canonicalizeAppProxyQuery(params) {
  return Object.keys(params)
    .sort((a, b) => a.localeCompare(b))
    .reduce(
      (acc, key) =>
        `${acc}${key}=${Array.isArray(params[key]) ? params[key].join(",") : params[key]}`,
      "",
    );
}

/** Hex-encoded HMAC-SHA256 of the canonicalised query. */
export function computeAppProxySignature(params, secret) {
  return createHmac("sha256", secret)
    .update(canonicalizeAppProxyQuery(params))
    .digest("hex");
}

/**
 * Constant-time comparison of a request's `signature` against a locally
 * computed one. Returns false — never throws — on any shape mismatch, so a
 * missing, empty or wrong-length signature simply declines.
 */
export function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  try {
    // Same shape as @shopify/shopify-api's safeCompare (TextEncoder + a
    // constant-time XOR loop), so there is one less place for the two to
    // disagree about what "equal" means.
    const enc = new TextEncoder();
    return timingSafeEqual(enc.encode(a), enc.encode(b));
  } catch {
    return false;
  }
}

/**
 * The shop to read data for, taken from a verified App Proxy request.
 * Returns null when the request is not a validly signed App Proxy request.
 */
export function verifyAppProxyShop(request, secret) {
  if (typeof secret !== "string" || secret.length === 0) return null;

  let url;
  let params;
  try {
    url = new URL(request.url);
    params = new URLSearchParams(url.search);
  } catch {
    return null;
  }

  const signature = params.get("signature");
  if (!signature) return null;

  const signed = {};
  for (const [key, value] of params.entries()) {
    if (key === "signature") continue;
    // A repeated key arrives as `key=v1&key=v2`; the library hands it to the
    // signer as an array, so match that rather than silently taking the last.
    if (key in signed) {
      signed[key] = [].concat(signed[key], value);
    } else {
      signed[key] = value;
    }
  }

  let expected;
  try {
    expected = computeAppProxySignature(signed, secret);
  } catch {
    return null;
  }
  if (!safeCompare(signature, expected)) return null;

  const shop = signed.shop;
  return typeof shop === "string" && shop.length > 0 ? shop : null;
}

// Reads `shop` off an already-authenticated context. Slow (session lookup) but
// independent of our canonicalisation, so it backs up verifyAppProxyShop().
export function resolveVerifiedProxyShop(auth) {
  const shop = auth?.session?.shop;
  return typeof shop === "string" && shop.length > 0 ? shop : null;
}
