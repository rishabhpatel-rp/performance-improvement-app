#!/usr/bin/env node
/**
 * T-5 helper: quick storefront checks (password store). Usage:
 *   STOREFRONT_URL=https://shop.com?password=2 node scripts/storefront-smoke.mjs
 */
import { chromium } from "playwright";

const url = process.env.STOREFRONT_URL;
if (!url) {
  console.error("Set STOREFRONT_URL");
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url, { waitUntil: "load", timeout: 60_000 });
await page.waitForTimeout(2000);

const cart = await page
  .evaluate(async () => {
    const r = await fetch("/cart.js", { credentials: "same-origin" });
    return r.ok;
  })
  .catch(() => false);

await browser.close();

const ok = cart && errors.length <= 2;
console.log(JSON.stringify({ ok, cart, jsErrors: errors.slice(0, 5) }, null, 2));
process.exit(ok ? 0 : 1);
