import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyCandidate,
  urlToCandidates,
  coverageVerdict,
  mergeSlugVariants,
  pageMatchPatterns,
  isNeverDeferPathname,
  shouldProtectUnknownCoverageScript,
  normalizeTokenForCrossRun,
} from "../app/lib/audit-candidates.ts";

test("classifyCandidate marks chunk scripts as never-defer", () => {
  assert.equal(classifyCandidate("chunk.shopify"), "never-defer");
});

test("urlToCandidates never-defers checkout-web bundles", () => {
  const b = urlToCandidates(
    "https://shop.myshopify.com/cdn/shopifycloud/checkout-web/assets/c1/foo.eWQwYodn.js",
    "https://shop.myshopify.com/",
  );
  assert.ok(b.neverDefer.length > 0);
});

test("urlToCandidates buckets third-party script", () => {
  const b = urlToCandidates("https://cdn.clarity.ms/tag.js", "https://shop.myshopify.com/");
  assert.ok(b.kept.some((t) => t.includes("clarity") || t.includes("tag")));
});

test("coverageVerdict idle when no functions ran", () => {
  assert.equal(
    coverageVerdict({
      url: "https://x/a.js",
      functions: [{ functionName: "", ranges: [{ count: 0 }] }],
    }),
    "idle",
  );
});

test("mergeSlugVariants unifies hash suffixes", () => {
  const merged = mergeSlugVariants(["store-ABC123", "store-DEF456"]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0], "store");
});

test("pageMatchPatterns includes pathname and wildcards", () => {
  const p = pageMatchPatterns("/products/foo-bar");
  assert.ok(p.some((x) => x.includes("products")));
});

test("NEVER_DEFER_CMP classifies onetrust as never-defer", () => {
  assert.equal(classifyCandidate("cdn/cmp/onetrust-sdk.js"), "never-defer");
});

test("urlToCandidates never-defers stripe host", () => {
  const b = urlToCandidates("https://js.stripe.com/v3/", "https://shop.myshopify.com/");
  assert.ok(b.neverDefer.includes("js.stripe.com"));
  assert.equal(b.kept.length, 0);
});

test("isNeverDeferPathname matches cart and checkout", () => {
  assert.equal(isNeverDeferPathname("/cart"), true);
  assert.equal(isNeverDeferPathname("/checkout"), true);
  assert.equal(isNeverDeferPathname("/products/x"), false);
});

test("shouldProtectUnknownCoverageScript late load is deferrable", () => {
  assert.equal(
    shouldProtectUnknownCoverageScript({ homeRequestOrder: 30, homeStartMs: 2500 }),
    false,
  );
});

test("normalizeTokenForCrossRun strips query and hash suffix", () => {
  assert.equal(normalizeTokenForCrossRun("files/analytics-k7sH3nP.js?v=1234"), "files/analytics");
});
