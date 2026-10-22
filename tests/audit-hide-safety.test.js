import test from "node:test";
import assert from "node:assert/strict";
import {
  applyHideSelectorHygiene,
  filterUnsafeHideSelectors,
  isUnsafeHideSelector,
} from "../app/lib/audit-hide-safety.server.ts";

test("isUnsafeHideSelector blocks lazy-load utility classes", () => {
  assert.equal(isUnsafeHideSelector(".lazyload"), true);
  assert.equal(isUnsafeHideSelector(".lazyloaded"), true);
  assert.equal(isUnsafeHideSelector(".logo-block__image.lazyload"), false);
  assert.equal(isUnsafeHideSelector(".jdgm-widget"), false);
});

test("filterUnsafeHideSelectors removes unsafe entries only", () => {
  const { safe, rejected } = filterUnsafeHideSelectors([
    ".lazyload",
    "#footer",
    ".lazyloaded",
  ]);
  assert.deepEqual(safe, ["#footer"]);
  assert.deepEqual(rejected, [".lazyload", ".lazyloaded"]);
});

test("applyHideSelectorHygiene emits warnings for rejected selectors", () => {
  const r = applyHideSelectorHygiene([".lazyload", ".yomi-benefit"]);
  assert.deepEqual(r.hideSelectors, [".yomi-benefit"]);
  assert.ok(r.warnings.some((w) => w.includes(".lazyload")));
});
