import test from "node:test";
import assert from "node:assert/strict";
import { buildTemplateDeferBuckets } from "../app/lib/audit-template-buckets.ts";

test("buildTemplateDeferBuckets: global intersection and per-template deltas", () => {
  const deferByPath = {
    "/": ["a", "b", "c"],
    "/collections/all": ["a", "b", "d"],
    "/products/x": ["a", "e"],
  };
  const pageRoles = {
    "/": "home",
    "/collections/all": "collection",
    "/products/x": "product",
  };
  const b = buildTemplateDeferBuckets(deferByPath, pageRoles);
  assert.deepEqual(b.global, ["a"]);
  assert.deepEqual(b.home, ["b", "c"]);
  assert.deepEqual(b.collection, ["b", "d"]);
  assert.deepEqual(b.product, ["e"]);
});

test("buildTemplateDeferBuckets: PDP required PLP defer only", () => {
  const deferByPath = {
    "/": ["shared"],
    "/collections/all": ["shared", "only-plp"],
    "/products/x": ["shared"],
  };
  const pageRoles = {
    "/": "home",
    "/collections/all": "collection",
    "/products/x": "product",
  };
  const b = buildTemplateDeferBuckets(deferByPath, pageRoles);
  assert.deepEqual(b.global, ["shared"]);
  assert.deepEqual(b.collection, ["only-plp"]);
  assert.deepEqual(b.product, []);
});
