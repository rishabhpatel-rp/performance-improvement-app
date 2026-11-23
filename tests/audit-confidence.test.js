import test from "node:test";
import assert from "node:assert/strict";
import {
  computeDeferConfidence,
  classifyDeferTier,
  DEFER_THRESHOLD,
} from "../app/lib/audit-confidence.ts";
import { shouldProtectUnknownCoverageScript } from "../app/lib/audit-candidates.ts";

test("shouldProtectUnknownCoverageScript protects early scripts", () => {
  assert.equal(shouldProtectUnknownCoverageScript({ homeRequestOrder: 3 }), true);
  assert.equal(shouldProtectUnknownCoverageScript({ homeStartMs: 400 }), true);
  assert.equal(
    shouldProtectUnknownCoverageScript({ homeRequestOrder: 40, homeStartMs: 3000 }),
    false,
  );
});

test("computeDeferConfidence favors idle late loads", () => {
  const high = computeDeferConfidence({
    coverageVerdict: "idle",
    loadingHint: "async",
    homeRequestOrder: 50,
    homeStartMs: 4000,
    totalPages: 3,
    appearsOnPages: 1,
  });
  const low = computeDeferConfidence({
    coverageVerdict: "ran",
    loadingHint: "blocking",
    homeRequestOrder: 2,
    homeStartMs: 200,
    totalPages: 3,
    appearsOnPages: 3,
  });
  assert.ok(high >= DEFER_THRESHOLD);
  assert.ok(low < DEFER_THRESHOLD);
});

test("classifyDeferTier maps unknown late to delay-every", () => {
  const tier = classifyDeferTier({
    confidence: 70,
    coverageVerdict: "unknown",
    homeRequestOrder: 45,
    homeStartMs: 5000,
    loadingHint: "unknown",
  });
  assert.equal(tier, "delay-every");
});

test("classifyDeferTier maps late idle async to delay-first", () => {
  const conf = computeDeferConfidence({
    coverageVerdict: "idle",
    loadingHint: "async",
    homeRequestOrder: 42,
    homeStartMs: 5000,
    totalPages: 3,
    appearsOnPages: 1,
  });
  const tier = classifyDeferTier({
    confidence: conf,
    coverageVerdict: "idle",
    homeRequestOrder: 42,
    homeStartMs: 5000,
    loadingHint: "async",
  });
  assert.equal(tier, "delay-first");
});

test("classifyDeferTier maps unknown early safe to delay-first", () => {
  const tier = classifyDeferTier({
    confidence: 72,
    coverageVerdict: "unknown",
    homeRequestOrder: 22,
    homeStartMs: 900,
    loadingHint: "async",
  });
  assert.equal(tier, "delay-first");
});
