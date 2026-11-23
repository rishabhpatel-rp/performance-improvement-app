import test from "node:test";
import assert from "node:assert/strict";
import { mergeSlugVariants, normalizeTokenForCrossRun } from "../app/lib/audit-candidates.ts";

test("T-4.2 mergeSlugVariants unifies build-hash variants", () => {
  const merged = mergeSlugVariants(["files/analytics-BTEJUR.js", "files/analytics-BTEJKB.js"]);
  assert.equal(merged.length, 1);
  assert.match(merged[0], /analytics/);
});

test("T-4.3 normalizeTokenForCrossRun strips version query params", () => {
  const a = normalizeTokenForCrossRun("files/analytics.js?v=1234");
  const b = normalizeTokenForCrossRun("files/analytics.js?v=5678");
  assert.equal(a, b);
});

test("mergeSlugVariants keeps distinct stems separate", () => {
  const merged = mergeSlugVariants(["gtm.js", "bat.js"]);
  assert.equal(merged.length, 2);
});
