import test from "node:test";
import assert from "node:assert/strict";
import { applyExtraPageDeferRules } from "../app/lib/audit-template-extra.ts";
import { urlToCandidates } from "../app/lib/audit-candidates.ts";

test("applyExtraPageDeferRules adds extra-only defer tokens to global", () => {
  const buckets = { global: ["a"], home: [], collection: [], product: [] };
  const deferByPath = {
    "/": ["a"],
    "/collections/all": ["a"],
    "/products/x": ["a"],
    "/pages/about": ["extra-only"],
  };
  const pageRoles = {
    "/": "home",
    "/collections/all": "collection",
    "/products/x": "product",
    "/pages/about": "extra",
  };
  const seen = { "/pages/about": new Set(["extra-only"]) };
  const out = applyExtraPageDeferRules(buckets, deferByPath, pageRoles, seen);
  assert.ok(out.global.includes("extra-only"));
});

test("applyExtraPageDeferRules vetoes global when seen on extra but not deferred", () => {
  const buckets = { global: ["a", "b"], home: [], collection: [], product: [] };
  const deferByPath = {
    "/": ["a", "b"],
    "/collections/all": ["a", "b"],
    "/products/x": ["a", "b"],
    "/pages/about": ["a"],
  };
  const pageRoles = {
    "/": "home",
    "/collections/all": "collection",
    "/products/x": "product",
    "/pages/about": "extra",
  };
  const seen = { "/pages/about": new Set(["a", "b"]) };
  const out = applyExtraPageDeferRules(buckets, deferByPath, pageRoles, seen);
  assert.ok(out.global.includes("a"));
  assert.ok(!out.global.includes("b"));
});

test("urlToCandidates yields tokens for storefront script URLs", () => {
  const b = urlToCandidates(
    "https://cdn.shopify.com/s/files/1/chunk.storefront.js",
    "https://shop.test/",
  );
  assert.ok(b.kept.length + b.neverDefer.length > 0);
});
