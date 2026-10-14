/**
 * Documented token rules for audit-candidates (server).
 * The in-page AUDIT_SCRIPT in audit-script.ts must stay aligned manually.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { urlToCandidates, classifyCandidate } from "../app/lib/audit-candidates.ts";

const FIXTURES = [
  {
    name: "shopify chunk never-defer",
    url: "https://cdn.shopify.com/s/files/1/chunk.storefront.js",
    page: "https://shop.test/",
    expectNever: true,
  },
  {
    name: "clarity tag kept",
    url: "https://www.clarity.ms/tag/abc",
    page: "https://shop.test/",
    expectKept: true,
  },
];

test("audit classify contract fixtures", () => {
  for (const f of FIXTURES) {
    const b = urlToCandidates(f.url, f.page);
    if (f.expectNever) {
      assert.ok(b.neverDefer.length > 0, f.name);
    }
    if (f.expectKept) {
      assert.ok(b.kept.length > 0 || b.neverDefer.length > 0, f.name);
    }
  }
  assert.equal(classifyCandidate("chunk.foo"), "never-defer");
  assert.equal(classifyCandidate("tag/abc"), "kept");
});
