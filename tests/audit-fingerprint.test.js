import assert from "node:assert/strict";
import { test } from "node:test";
import { buildScriptListFingerprint, fingerprintFromReport } from "../app/lib/audit-fingerprint.ts";
import { effectiveMaxScrollSteps } from "../app/lib/audit-settle.ts";
import { resetEnvCacheForTests } from "../app/lib/env.server.ts";

test("buildScriptListFingerprint is order-independent", () => {
  const a = buildScriptListFingerprint(["gtm.js", "assets/theme.js"]);
  const b = buildScriptListFingerprint(["assets/theme.js", "gtm.js", "gtm.js"]);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});

test("buildScriptListFingerprint changes when a token is added", () => {
  const a = buildScriptListFingerprint(["a.js"]);
  const b = buildScriptListFingerprint(["a.js", "b.js"]);
  assert.notEqual(a, b);
});

test("fingerprintFromReport prefers stored auditRunMeta fingerprint", () => {
  const fp = buildScriptListFingerprint(["x.js"]);
  const got = fingerprintFromReport({
    auditRunMeta: { scriptListFingerprint: fp },
    deferArray: ["ignored.js"],
  });
  assert.equal(got, fp);
});

test("fingerprintFromReport falls back to defer/neverDefer tokens", () => {
  const expected = buildScriptListFingerprint(["defer.js", "chunk.js"]);
  const got = fingerprintFromReport({
    deferArray: ["defer.js"],
    neverDefer: ["chunk.js"],
  });
  assert.equal(got, expected);
});

test("effectiveMaxScrollSteps caps non-home at 15 when scroll adapt on", () => {
  resetEnvCacheForTests();
  process.env.AUDIT_SCROLL_ADAPT = "true";
  resetEnvCacheForTests();
  // 40_000px / 900 ≈ 45 natural steps → home keeps 40, non-home caps 15
  assert.equal(effectiveMaxScrollSteps(40_000, true), 40);
  assert.equal(effectiveMaxScrollSteps(40_000, false), 15);
  // Short page: natural ~4 → still at least MIN (via later Math.max in caller);
  // effective max itself is min(max(4,6),15)=6 for non-home
  assert.equal(effectiveMaxScrollSteps(3_600, false), 6);
});
