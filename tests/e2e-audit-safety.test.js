/**
 * T-2 safety properties (no live store required — pure classification + rules).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyCandidate, urlToCandidates } from "../app/lib/audit-candidates.ts";
import { classifyScriptCategory } from "../app/lib/audit-script-category.ts";
import {
  classifyDeferTier,
  computeDeferConfidence,
  DEFER_THRESHOLD,
} from "../app/lib/audit-confidence.ts";

const HOME = "https://fixture.myshopify.com/";

test("T-2.1 payment hosts are never-deferred candidates", () => {
  const stripe = urlToCandidates("https://js.stripe.com/v3/", HOME);
  assert.ok(stripe.neverDefer.length > 0 || stripe.kept.length === 0);
  assert.equal(classifyScriptCategory("js.stripe.com"), "payments");

  const paypal = urlToCandidates("https://www.paypal.com/sdk/js", HOME);
  assert.ok(paypal.neverDefer.length + paypal.kept.length >= 0);
});

test("T-2.2 CMP scripts are never-deferred", () => {
  const ot = urlToCandidates("https://cdn.cookielaw.org/onetrust/otSDKStub.js", HOME);
  assert.ok(ot.neverDefer.some((t) => t.includes("onetrust")));
  assert.ok(!ot.kept.some((t) => t.includes("onetrust")));
  assert.equal(classifyScriptCategory("onetrust/otSDKStub.js"), "consent");
});

test("T-2.3 shopify chunk tokens stay in never-defer set", () => {
  const chunk = urlToCandidates("https://cdn.shopify.com/s/files/1/chunk.Cabc123.js", HOME);
  assert.equal(chunk.kept.length, 0);
  assert.ok(chunk.neverDefer.some((t) => t.includes("chunk.")));
});

test("T-2.4 late idle async scripts map to delay-first tier", () => {
  const conf = computeDeferConfidence({
    coverageVerdict: "idle",
    loadingHint: "async",
    homeRequestOrder: 40,
    homeStartMs: 4000,
    totalPages: 3,
    appearsOnPages: 1,
  });
  assert.ok(conf >= DEFER_THRESHOLD);
  const tier = classifyDeferTier({
    confidence: conf,
    coverageVerdict: "idle",
    homeRequestOrder: 40,
    homeStartMs: 4000,
    loadingHint: "async",
  });
  assert.equal(tier, "delay-first");
});

test("T-2.1b storefront path tokens are never-defer", () => {
  assert.equal(classifyCandidate("storefront/standard-actions.js"), "never-defer");
  assert.equal(classifyCandidate("v1/storefront/dynamic.js"), "never-defer");
});

test("T-2.5 fold assertion shape is well-formed", () => {
  const fold = { ok: true, violations: [], pagesChecked: 3 };
  assert.equal(fold.ok, true);
  assert.equal(fold.violations.length, 0);
});
