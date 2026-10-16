import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import {
  canonicalizeAppProxyQuery,
  computeAppProxySignature,
  resolveVerifiedProxyShop,
  safeCompare,
  verifyAppProxyShop,
} from "../app/lib/proxy-shop.js";

// ---------------------------------------------------------------------------
// The pre-existing session-based path (REMEDIATION Task 2 / audit finding H2).
// ---------------------------------------------------------------------------

test("returns the verified session shop", () => {
  assert.equal(
    resolveVerifiedProxyShop({ session: { shop: "a.myshopify.com" } }),
    "a.myshopify.com",
  );
});

test("never trusts anything else (regression: unsigned ?shop= fallback)", () => {
  assert.equal(resolveVerifiedProxyShop(undefined), null);
  assert.equal(resolveVerifiedProxyShop({}), null);
  assert.equal(resolveVerifiedProxyShop({ session: null }), null);
  assert.equal(resolveVerifiedProxyShop({ session: { shop: "" } }), null);
  assert.equal(resolveVerifiedProxyShop({ shop: "victim.myshopify.com" }), null);
});

// ---------------------------------------------------------------------------
// In-process App Proxy signature verification (ARCHITECTURE_AND_DECISIONS.md §4 B3).
//
// The storefront script route runs on every page load for every shopper.
// `authenticate.public.appProxy` proves the same `shop` but also loads the
// offline session, which triggers a Shopify OAuth token refresh roughly hourly
// on a shopper request path. These tests pin the cheaper proof.
// ---------------------------------------------------------------------------

const SECRET = "test-fixture-app-secret";
const SHOP = "acme.myshopify.com";

/** Build a request the way Shopify's AppProxyProvider signs one. */
function signedRequest(params, secret = SECRET) {
  const signed = computeAppProxySignature(params, secret);
  const url = new URL("https://acme.myshopify.com/apps/performance-scripts");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.append(k, Array.isArray(v) ? v.join(",") : v);
  }
  url.searchParams.append("signature", signed);
  return new Request(url.toString());
}

test("a correctly signed request resolves its shop", () => {
  const req = signedRequest({ shop: SHOP, path_prefix: "/apps" });
  assert.equal(verifyAppProxyShop(req, SECRET), SHOP);
});

test("an UNSIGNED request is refused, so ?shop= can never be trusted", () => {
  // The exact attack from audit finding H2: guess a victim's domain.
  const url = new URL("https://victim.myshopify.com/apps/performance-scripts");
  url.searchParams.set("shop", "victim.myshopify.com");
  assert.equal(verifyAppProxyShop(new Request(url.toString()), SECRET), null);
});

test("a signature computed with the WRONG secret is refused", () => {
  const req = signedRequest({ shop: SHOP }, "a-different-secret");
  assert.equal(verifyAppProxyShop(req, SECRET), null);
});

test("tampering with shop after signing is refused", () => {
  const req = signedRequest({ shop: SHOP, path_prefix: "/apps" });
  const tampered = new Request(
    req.url.replace(`shop=${SHOP}`, "shop=evil.myshopify.com"),
  );
  assert.equal(verifyAppProxyShop(tampered, SECRET), null);
});

test("adding a parameter after signing is refused", () => {
  const req = signedRequest({ shop: SHOP });
  const tampered = new Request(req.url.replace("?", "?injected=1&"));
  assert.equal(verifyAppProxyShop(tampered, SECRET), null);
});

test("removing a parameter after signing is refused", () => {
  const req = signedRequest({ shop: SHOP, path_prefix: "/apps", extra: "x" });
  const tampered = new Request(req.url.replace("&extra=x", ""));
  assert.equal(verifyAppProxyShop(tampered, SECRET), null);
});

test("a missing signature param is refused", () => {
  const url = new URL("https://acme.myshopify.com/apps/performance-scripts");
  url.searchParams.set("shop", SHOP);
  assert.equal(verifyAppProxyShop(new Request(url.toString()), SECRET), null);
});

test("a blank or missing secret refuses rather than skipping verification", () => {
  // Silently accepting with no secret would be a fail-OPEN auth bypass.
  const req = signedRequest({ shop: SHOP });
  for (const bad of ["", undefined, null, 0, {}, 42]) {
    assert.equal(verifyAppProxyShop(req, bad), null, JSON.stringify(bad));
  }
});

test("a valid signature but no shop param yields null, not an empty string", () => {
  const req = signedRequest({ path_prefix: "/apps" });
  assert.equal(verifyAppProxyShop(req, SECRET), null);
});

test("a signed but empty shop is refused", () => {
  const req = signedRequest({ shop: "" });
  assert.equal(verifyAppProxyShop(req, SECRET), null);
});

test("a malformed URL is refused, never thrown", () => {
  const req = { url: "::::not a url" };
  assert.equal(verifyAppProxyShop(req, SECRET), null);
});

test("a request object without .url is refused", () => {
  for (const r of [undefined, null, {}, { url: null }, { url: 42 }]) {
    assert.equal(verifyAppProxyShop(r, SECRET), null, JSON.stringify(r));
  }
});

// --- canonicalisation ------------------------------------------------------
// Mirrors @shopify/shopify-api's stringifyQueryForAppProxy: keys sorted
// ascending, concatenated with NO separator (not `&`).

test("canonicalisation sorts keys and concatenates with no separator", () => {
  assert.equal(
    canonicalizeAppProxyQuery({ path_prefix: "/apps", shop: "a.myshopify.com" }),
    "path_prefix=/appsshop=a.myshopify.com",
  );
});

test("canonicalisation is order-independent", () => {
  const a = canonicalizeAppProxyQuery({ z: "1", a: "2", shop: "s" });
  const b = canonicalizeAppProxyQuery({ shop: "s", a: "2", z: "1" });
  assert.equal(a, b);
});

test("canonicalisation joins array values with a comma", () => {
  assert.equal(canonicalizeAppProxyQuery({ m: ["b", "a"] }), "m=b,a");
});

test("canonicalisation preserves a comma inside a value (not split)", () => {
  assert.equal(canonicalizeAppProxyQuery({ tags: "a,b,c" }), "tags=a,b,c");
});

test("canonicalisation does not URL-encode (it signs the raw values)", () => {
  // Shopify signs the decoded values, so encoding here would never match.
  assert.equal(canonicalizeAppProxyQuery({ p: "/a b" }), "p=/a b");
  assert.equal(canonicalizeAppProxyQuery({ q: "a&b=c" }), "q=a&b=c");
});

test("canonicalisation handles an empty key and empty values", () => {
  assert.equal(canonicalizeAppProxyQuery({ "": "v", shop: "s" }), "=vshop=s");
  assert.equal(canonicalizeAppProxyQuery({ a: "" }), "a=");
});

test("canonicalisation of nothing is the empty string", () => {
  assert.equal(canonicalizeAppProxyQuery({}), "");
});

// --- signature -------------------------------------------------------------

test("the signature is hex HMAC-SHA256 over the canonical string", () => {
  const params = { shop: SHOP };
  const expected = createHmac("sha256", SECRET)
    .update(canonicalizeAppProxyQuery(params))
    .digest("hex");
  assert.equal(computeAppProxySignature(params, SECRET), expected);
  assert.match(expected, /^[0-9a-f]{64}$/);
});

test("different secrets give different signatures for the same query", () => {
  assert.notEqual(
    computeAppProxySignature({ shop: SHOP }, SECRET),
    computeAppProxySignature({ shop: SHOP }, "other"),
  );
});

test("safeCompare is length-safe and type-safe, and never throws", () => {
  assert.equal(safeCompare("abc", "abc"), true);
  assert.equal(safeCompare("abc", "abd"), false);
  // Differing lengths must not throw (timingSafeEqual would).
  assert.equal(safeCompare("abc", "abcdef"), false);
  assert.equal(safeCompare("", ""), true);
  for (const bad of [undefined, null, 1, {}, []]) {
    assert.equal(safeCompare(bad, "abc"), false);
    assert.equal(safeCompare("abc", bad), false);
  }
});

test("a repeated query param round-trips as the array the signer used", () => {
  // `?k=b&k=a` must canonicalise the same as the array form Shopify signs.
  const url = new URL("https://acme.myshopify.com/x");
  url.searchParams.append("k", "b");
  url.searchParams.append("k", "a");
  url.searchParams.append("shop", SHOP);
  const params = Object.fromEntries(new URLSearchParams(url.search));
  params.signature = computeAppProxySignature({ k: ["b", "a"], shop: SHOP }, SECRET);
  const signed = new URL(url);
  signed.searchParams.set("signature", params.signature);
  assert.equal(verifyAppProxyShop(new Request(signed.toString()), SECRET), SHOP);
});

// --- cross-check against the real library ----------------------------------
// The whole point of hand-rolling this is to skip the session lookup, so the
// canonicalisation must stay byte-identical to @shopify/shopify-api's. These
// tests fail loudly if Shopify ever changes it.

test("our canonicalisation is accepted by @shopify/shopify-api", async (t) => {
  let validateHmac;
  try {
    await import("@shopify/shopify-app-react-router/adapters/node");
    const { shopifyApi, ApiVersion } = await import("@shopify/shopify-api");
    validateHmac = shopifyApi({
      apiKey: "x",
      apiSecretKey: SECRET,
      scopes: [],
      hostName: "h",
      apiVersion: ApiVersion.July26,
    }).utils.validateHmac;
  } catch (err) {
    t.skip("shopify-api unavailable: " + err.message);
    return;
  }

  const cases = [
    { shop: SHOP, path_prefix: "/apps", logged_in_customer_id: "" },
    { shop: "b.myshopify.com" },
    { shop: "c.myshopify.com", path_prefix: "/apps/performance-scripts", multi: ["b", "a"] },
    { z: "1", a: "2", shop: "d.myshopify.com", "": "empty-key" },
    { shop: "e.myshopify.com", tags: "a,b,c" },
    { shop: "f.myshopify.com", unicode: "café", amp: "a&b=c" },
    { shop: "g.myshopify.com", preview_theme_id: "123", extra: "x" },
  ];
  for (const q of cases) {
    const sig = computeAppProxySignature(q, SECRET);
    assert.equal(
      await validateHmac({ ...q, signature: sig }, { signator: "appProxy" }),
      true,
      "shopify-api rejected our canonicalisation of " + JSON.stringify(q),
    );
  }
});

test("a signature ours accepts is one shopify-api also accepts (no false positives)", async (t) => {
  let validateHmac;
  try {
    await import("@shopify/shopify-app-react-router/adapters/node");
    const { shopifyApi, ApiVersion } = await import("@shopify/shopify-api");
    validateHmac = shopifyApi({
      apiKey: "x",
      apiSecretKey: SECRET,
      scopes: [],
      hostName: "h",
      apiVersion: ApiVersion.July26,
    }).utils.validateHmac;
  } catch (err) {
    t.skip("shopify-api unavailable: " + err.message);
    return;
  }

  // Anything we ACCEPT must also verify under the library, or we are the weakest
  // link in the chain.
  const candidates = [
    { shop: SHOP, path_prefix: "/apps" },
    { shop: "x.myshopify.com", unicode: "café", amp: "a&b=c", arr: ["q", "p"] },
    { "": "empty", a: "1", shop: "y.myshopify.com" },
  ];
  for (const q of candidates) {
    const params = Object.fromEntries(
      Object.entries(q).map(([k, v]) => [k, Array.isArray(v) ? v.join(",") : v]),
    );
    const url = new URL("https://acme.myshopify.com/x");
    for (const [k, v] of Object.entries(params)) url.searchParams.append(k, v);
    const req = new Request(url.toString() + "&signature=" + computeAppProxySignature(q, SECRET));
    const ours = verifyAppProxyShop(req, SECRET);
    assert.ok(ours, "fixture must be accepted by us for this test to mean anything");
    assert.equal(
      await validateHmac({ ...params, signature: req.url.split("signature=")[1] }, { signator: "appProxy" }),
      true,
      "we accepted a signature shopify-api rejects — fail-OPEN",
    );
  }
});

test("a forged signature is rejected by shopify-api too", async (t) => {
  let validateHmac;
  try {
    await import("@shopify/shopify-app-react-router/adapters/node");
    const { shopifyApi, ApiVersion } = await import("@shopify/shopify-api");
    validateHmac = shopifyApi({
      apiKey: "x",
      apiSecretKey: SECRET,
      scopes: [],
      hostName: "h",
      apiVersion: ApiVersion.July26,
    }).utils.validateHmac;
  } catch (err) {
    t.skip("shopify-api unavailable: " + err.message);
    return;
  }
  assert.equal(
    await validateHmac(
      { shop: "evil.myshopify.com", signature: "deadbeef".repeat(8) },
      { signator: "appProxy" },
    ),
    false,
  );
});

// --- the fallback wiring ---------------------------------------------------

test("the route tries the fast path and falls back to the session path", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync("app/routes/api.storefront-scripts.jsx", "utf8"),
  );
  assert.match(src, /verifyAppProxyShop\(request, process\.env\.SHOPIFY_API_SECRET\)/);
  assert.match(src, /\?\?\s*\n?\s*resolveVerifiedProxyShop\(await authenticate\.public\.appProxy\(request\)\)/);
  // The session path must remain the fallback, never be deleted.
  assert.match(src, /authenticate\.public\.appProxy/);
  // And an unresolved shop must still yield the OFF script, never shop data.
  assert.match(src, /if \(!shopDomain\) \{\s*return scriptResponse\(request, OFF_SCRIPT, null\);/);
});
