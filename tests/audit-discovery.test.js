import { test } from "node:test";
import assert from "node:assert/strict";
import { pickPagesFromDiscovery, findPagesInHtml } from "../app/lib/audit-discovery.ts";

const SHOP = "shop.myshopify.com";

test("N-1: no published products means no PLP/PDP, so only home is audited", () => {
  const found = pickPagesFromDiscovery(
    { collections: { nodes: [] }, products: { nodes: [] } },
    SHOP,
  );
  assert.equal(found.plp, undefined);
  assert.equal(found.pdp, undefined);
});

test("N-1: a collection with a storefront product yields both pages", () => {
  const found = pickPagesFromDiscovery(
    {
      collections: {
        nodes: [
          {
            handle: "summer",
            products: { nodes: [{ handle: "hat", onlineStoreUrl: "https://x/p" }] },
          },
        ],
      },
      products: { nodes: [{ handle: "hat", onlineStoreUrl: "https://x/p" }] },
    },
    SHOP,
  );
  assert.equal(found.plp, `https://${SHOP}/collections/summer`);
  assert.equal(found.pdp, `https://${SHOP}/products/hat`);
});

test("N-1: with products but no published collection, /collections/all is used", () => {
  const found = pickPagesFromDiscovery(
    { collections: { nodes: [] }, products: { nodes: [{ handle: "hat" }] } },
    SHOP,
  );
  assert.equal(found.plp, `https://${SHOP}/collections/all`);
  assert.equal(found.pdp, `https://${SHOP}/products/hat`);
});

test("N-1: a collection whose products are not on the storefront is ignored", () => {
  const found = pickPagesFromDiscovery(
    {
      collections: {
        nodes: [{ handle: "draft", products: { nodes: [{ handle: "secret" }] } }],
      },
      products: { nodes: [] },
    },
    SHOP,
  );
  assert.equal(found.plp, undefined);
  assert.equal(found.pdp, undefined);
});

test("N-2: /collections/all and /products/... HTML fallback", () => {
  const found = findPagesInHtml(
    `<a href="/collections/all">All</a><a href="/products/hat">Hat</a>`,
    `https://${SHOP}/`,
  );
  assert.equal(found.plp, `https://${SHOP}/collections/all`);
  assert.equal(found.pdp, `https://${SHOP}/products/hat`);
});

test("N-2: /shop and /catalog collection aliases", () => {
  assert.equal(
    findPagesInHtml(`<a href="/shop/sale">Sale</a>`, `https://${SHOP}/`).plp,
    `https://${SHOP}/shop/sale`,
  );
  assert.equal(
    findPagesInHtml(`<a href="/catalog/gifts">Gifts</a>`, `https://${SHOP}/`).plp,
    `https://${SHOP}/catalog/gifts`,
  );
});

test("N-2: /collection and /product singular aliases", () => {
  const found = findPagesInHtml(
    `<a href="/collection/new">New</a><a href="/product/hat">Hat</a>`,
    `https://${SHOP}/`,
  );
  assert.equal(found.plp, `https://${SHOP}/collection/new`);
  assert.equal(found.pdp, `https://${SHOP}/product/hat`);
});

test("N-2: query strings and fragments are stripped from discovered links", () => {
  const found = findPagesInHtml(
    `<a href="/collections/all?sort_by=best#x">All</a><a href='/products/hat?x=1'>Hat</a>`,
    `https://${SHOP}/`,
  );
  assert.equal(found.plp, `https://${SHOP}/collections/all`);
  assert.equal(found.pdp, `https://${SHOP}/products/hat`);
});

test("N-2: empty HTML returns no pages without throwing", () => {
  const empty = findPagesInHtml("", `https://${SHOP}/`);
  assert.equal(empty.plp, undefined);
  assert.equal(empty.pdp, undefined);
});
