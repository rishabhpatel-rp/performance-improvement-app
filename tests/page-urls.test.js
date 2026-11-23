import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCustomUrl, normalizeCustomUrlList } from "../app/lib/page-urls.server.ts";
import { MAX_EXTRA_PAGES } from "../app/lib/constants.ts";

const SHOP = "demo.myshopify.com";

test("myshopify host still accepted", () => {
  const r = normalizeCustomUrl(`${SHOP}/collections/all`, SHOP, "plp");
  assert.equal(r.ok, true);
  assert.equal(r.url, `https://${SHOP}/collections/all`);
});

test("custom domain is accepted when cached on the store (D-3)", () => {
  const r = normalizeCustomUrl("https://shop.example.com/pages/about", SHOP, "page", [
    "shop.example.com",
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.url, "https://shop.example.com/pages/about");
});

test("an unrelated host is still rejected", () => {
  const r = normalizeCustomUrl("https://evil.example.com/collections/all", SHOP, "plp", [
    "shop.example.com",
  ]);
  assert.equal(r.ok, false);
  assert.match(r.error, /own store/);
});

test("share-link credentials are stripped from custom-domain URLs", () => {
  const r = normalizeCustomUrl(
    "https://shop.example.com/pages/about?_bt=abc&key=secret&preview_theme_id=1&x=keep",
    SHOP,
    "page",
    ["shop.example.com"],
  );
  assert.equal(r.url, "https://shop.example.com/pages/about?x=keep");
});

test(`extra page list is capped at ${MAX_EXTRA_PAGES}`, () => {
  const urls = Array.from({ length: MAX_EXTRA_PAGES + 2 }, (_, i) => `/pages/p${i}`);
  const r = normalizeCustomUrlList(urls, SHOP);
  assert.equal(r.ok, false);
  assert.equal(r.tooMany, true);
  assert.match(r.errors[0], new RegExp(`up to ${MAX_EXTRA_PAGES}`));
  assert.deepEqual(r.urls, []);
});

test("exactly the cap is accepted and de-duplicated", () => {
  const urls = Array.from({ length: MAX_EXTRA_PAGES - 1 }, (_, i) => `/pages/p${i}`);
  urls.push("/pages/p0");
  const r = normalizeCustomUrlList(urls, SHOP);
  assert.equal(r.ok, true);
  assert.equal(r.urls.length, MAX_EXTRA_PAGES - 1);
});

test("extra list accepts custom domain rows", () => {
  const r = normalizeCustomUrlList(["https://shop.example.com/pages/a"], SHOP, [
    "shop.example.com",
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.urls[0], "https://shop.example.com/pages/a");
});
