import test from "node:test";
import assert from "node:assert/strict";
import {
  applyFoldPolicy,
  FOLD_ASSERTION_STRIPPED_HIDE,
} from "../app/lib/audit-fold-policy.server.ts";

test("applyFoldPolicy passes hide list when fold assertion ok", () => {
  const r = applyFoldPolicy(["#footer"], {
    ok: true,
    violations: [],
    pagesChecked: 2,
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.hideSelectors, ["#footer"]);
  assert.equal(r.warnings.length, 0);
});

test("applyFoldPolicy strips hide when fold assertion fails (D1=A)", () => {
  const r = applyFoldPolicy([".bad"], {
    ok: false,
    violations: [".bad"],
    pagesChecked: 2,
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.hideSelectors, []);
  assert.ok(r.warnings.includes(FOLD_ASSERTION_STRIPPED_HIDE));
});
