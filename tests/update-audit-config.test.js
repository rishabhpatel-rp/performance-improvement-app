import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTemplateSavePatch,
  recomputeUnionColumns,
} from "../app/lib/update-audit-config-pure.ts";

test("buildTemplateSavePatch recomputes unions from template buckets", () => {
  const patch = buildTemplateSavePatch(
    {
      auditDeferArrayEnabled: true,
      auditDeferGlobal: ["a"],
      auditDeferHome: ["b"],
    },
    {
      auditDeferProduct: ["c"],
    },
  );
  assert.deepEqual(patch.auditDeferProduct, ["c"]);
  assert.equal(patch.auditDeferArray.includes("a"), true);
  assert.equal(patch.auditDeferArray.includes("b"), true);
  assert.equal(patch.auditDeferArray.includes("c"), true);
});

test("recomputeUnionColumns unions all scopes", () => {
  const unions = recomputeUnionColumns({
    auditDeferGlobal: ["wpm"],
    auditDeferHome: ["gtm"],
    auditDeferCollection: [],
    auditDeferProduct: ["wpm"],
  });
  assert.deepEqual(unions.auditDeferArray.sort(), ["gtm", "wpm"]);
});
