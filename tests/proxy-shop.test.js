import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveVerifiedProxyShop } from "../app/lib/proxy-shop.js";

test("returns the verified session shop", () => {
  assert.equal(
    resolveVerifiedProxyShop({ session: { shop: "a.myshopify.com" } }),
    "a.myshopify.com",
  );
});

test("never trusts anything else (regression: unsigned ?shop= fallback)", () => {
  assert.equal(resolveVerifiedProxyShop(undefined), null);
  assert.equal(resolveVerifiedProxyShop({}), null);
  assert.equal(resolveVerifiedProxyShop({ session: null }), null);
  assert.equal(resolveVerifiedProxyShop({ session: { shop: "" } }), null);
  assert.equal(resolveVerifiedProxyShop({ shop: "victim.myshopify.com" }), null);
});
