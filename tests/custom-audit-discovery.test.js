import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findGenericPagesInHtml,
  findPagesInStructuredData,
  findPagesInSitemap,
} from "../app/lib/audit-discovery.ts";
import { isPasswordAuditPath } from "../app/lib/custom-audit-discovery.server.ts";

const HOME = "https://example.com/";

test("custom discovery: generic category and product paths are found in HTML", () => {
  const found = findGenericPagesInHtml(
    `<a href="/category/shoes">Shoes</a><a href="/item/hat">Hat</a>`,
    HOME,
  );
  assert.equal(found.plp, "https://example.com/category/shoes");
  assert.equal(found.pdp, "https://example.com/item/hat");
});

test("custom discovery: JSON-LD CollectionPage and Product provide PLP/PDP", () => {
  const html = `<script type="application/ld+json">{"@graph":[
    {"@type":"CollectionPage","url":"/collections/all"},
    {"@type":"Product","url":"/products/hat"}
  ]}</script>`;
  const found = findPagesInStructuredData(html, HOME);
  assert.equal(found.plp, "https://example.com/collections/all");
  assert.equal(found.pdp, "https://example.com/products/hat");
});

test("custom discovery: cross-origin structured data is ignored", () => {
  const html = `<script type="application/ld+json">{"@type":"Product","url":"https://evil.test/hat"}</script>`;
  assert.equal(findPagesInStructuredData(html, HOME).pdp, undefined);
});

test("custom discovery: the password page is never audited as an extra page", () => {
  assert.equal(isPasswordAuditPath("https://shop.myshopify.com/password"), true);
  assert.equal(isPasswordAuditPath("https://shop.myshopify.com/password/"), true);
  assert.equal(isPasswordAuditPath("https://shop.myshopify.com/collections/all"), false);
});

test("custom discovery: sitemap paths become candidates", () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.com/shop/all</loc></url>
    <url><loc>https://example.com/products/hat</loc></url>
    <url><loc>https://other.test/x</loc></url>
  </urlset>`;
  const found = findPagesInSitemap(xml, HOME);
  assert.equal(found.plp, "https://example.com/shop/all");
  assert.equal(found.pdp, "https://example.com/products/hat");
  assert.equal(found.extras.length, 2);
});
