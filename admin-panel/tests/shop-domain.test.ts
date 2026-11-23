import test from "node:test";
const RUN = Math.random().toString(36).slice(2);
import assert from "node:assert/strict";
import { parseShopDomain } from "../src/lib/shop-domain.ts";
import { consumeRateLimit } from "../src/lib/rate-limit.ts";

test("parseShopDomain normalises valid myshopify domains", async () => {
  assert.equal(parseShopDomain(" Demo-Store.myshopify.com "), "demo-store.myshopify.com");
});

test("parseShopDomain rejects anything else", async () => {
  for (const bad of [
    "",
    "example.com",
    "a.myshopify.com.evil.io",
    "x/y.myshopify.com",
    "%E0%A4%A.myshopify.com",
    "-a.myshopify.com",
  ]) {
    assert.equal(parseShopDomain(bad), null, bad);
  }
});

test("consumeRateLimit blocks after the budget and reports retry time", async () => {
  const opts = { max: 2, windowMs: 60_000 };
  const now = 1_000_000;
  assert.equal((await consumeRateLimit(`${RUN}:t:consume`, opts, now)).allowed, true);
  assert.equal((await consumeRateLimit(`${RUN}:t:consume`, opts, now)).allowed, true);
  const blocked = await consumeRateLimit(`${RUN}:t:consume`, opts, now + 1000);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.retryAfterSeconds, 59);
  assert.equal((await consumeRateLimit(`${RUN}:t:consume`, opts, now + 61_000)).allowed, true);
});

import { storeRowsToCsv } from "../src/lib/store-csv.ts";

test("UX-25: store table CSV export quotes and escapes fields", () => {
  const csv = storeRowsToCsv(
    [{ shopName: 'Acme "Fast"', shopDomain: "acme.myshopify.com", isActive: true }],
    [
      { key: "shopName", label: "Shop Name" },
      { key: "shopDomain", label: "Domain" },
    ],
  );
  assert.match(csv, /"Shop Name","Domain"/);
  assert.match(csv, /"Acme ""Fast""","acme\.myshopify\.com"/);
  assert.match(csv, /\r\n/);
});
