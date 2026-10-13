import test from "node:test";
import assert from "node:assert/strict";
import { urlToCandidates } from "../app/lib/audit-candidates.ts";

/**
 * Inventory merges resources with candidate tokens; exercise the same token
 * mapping the inventory module uses (without loading audit-inventory.server.ts,
 * which pulls extensionless imports Node cannot resolve in --test).
 */
test("inventory token mapping defers clarity host and never-defers shopify chunk", () => {
  const page = "https://shop.test/";
  const clarity = urlToCandidates("https://www.clarity.ms/tag/abc", page);
  const shopify = urlToCandidates(
    "https://cdn.shopify.com/s/files/1/chunk.storefront.js",
    page,
  );
  const clarityToken = clarity.kept[0] || clarity.neverDefer[0];
  const shopToken = shopify.neverDefer[0] || shopify.kept[0];
  assert.ok(clarityToken);
  assert.ok(shopToken);
  assert.equal(clarityToken, "tag/abc");
  assert.ok(shopify.neverDefer.length > 0, "shopify chunk should be never-defer");
});
