// End-to-end test of the audit script's popup block in a real browser.
// Skipped automatically when Playwright's Chromium is not installed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import { POPUP_AUDIT_JS } from "../app/lib/popup-audit.js";

// audit-script.ts is TypeScript, and `node --test` on Node 20 cannot import it,
// so evaluate its AUDIT_SCRIPT template literal exactly as TypeScript would.
const tsSource = fs.readFileSync(new URL("../app/lib/audit-script.ts", import.meta.url), "utf8");
const body = tsSource.match(/export const AUDIT_SCRIPT = `([\s\S]*?)`;\n/)[1];
const AUDIT = new Function("POPUP_AUDIT_JS", "return `" + body + "`")(POPUP_AUDIT_JS);
// Same two substitutions as buildGatedSinglePageAuditScript().
const GATE =
  "window.__ppAuditGate=new Promise(function(r){window.__ppOpenGate=r});" +
  AUDIT.replace("var PAGES=[];", 'var PAGES=["http://x/"];').replace(
    "await wait(WAIT_MS)",
    "await (window.__ppAuditGate||wait(WAIT_MS))",
  );

const SHELL = (head, inner, script = "") => `<!doctype html><html><head><meta charset="utf-8"><style>
body{margin:0;font:16px sans-serif}
header.site-header{position:fixed;top:0;left:0;right:0;height:70px;background:#eee;z-index:500}
.hero{margin-top:70px;height:500px;position:relative}.banner__overlay{position:absolute;inset:0}
.sticky-atc{position:fixed;bottom:0;left:0;right:0;height:60px;background:#fff;z-index:400}
.chat-launcher{position:fixed;right:20px;bottom:100px;width:56px;height:56px;z-index:900}
.footer__newsletter{height:200px;margin-top:1200px}
.cc-banner{position:fixed;bottom:0;left:0;right:0;height:90px;background:#222;color:#fff;z-index:9999}
.newsletter-popup{position:fixed;top:20%;left:30%;width:40%;height:50%;background:#fff;z-index:2000}
.modal{display:none;position:fixed;inset:0;z-index:1050}.modal.show{display:block}
.xyz-box{position:fixed;top:15%;left:20%;width:60%;height:60%;background:#ff9;z-index:3000}
${head}</style></head><body>
<header class="site-header"><nav>Menu</nav></header>
<main id="MainContent"><section class="hero"><div class="banner__overlay"></div><h1>Welcome</h1></section>
<div class="sticky-atc"><button>Add to cart</button></div><div class="chat-launcher"></div>
<div class="footer__newsletter"><h2>Newsletter</h2></div></main>${inner}<script>${script}</script></body></html>`;

const PAGES = {
  "/popups": SHELL("", `
<div class="cc-banner"><p>We use cookies. Accept all</p></div>
<dialog id="promo-dialog"><p>Promo</p></dialog>
<div class="modal fade" id="quickview-modal">QV</div>`, `
setTimeout(function(){document.getElementById('promo-dialog').showModal()},200);
setTimeout(function(){var d=document.createElement('div');d.className='newsletter-popup is-open';
  document.body.appendChild(d);setTimeout(function(){d.remove()},500)},300);
setTimeout(function(){document.getElementById('quickview-modal').classList.add('show')},900);
setTimeout(function(){var d=document.createElement('div');d.className='xyz-box';d.textContent='Spin';document.body.appendChild(d)},700);
document.addEventListener('mouseleave',function(e){if(e.clientY<=0){var d=document.createElement('div');d.className='exit-offer-modal';
  d.style.cssText='position:fixed;top:10%;left:10%;width:50%;height:50%;z-index:5000;background:#fff';document.body.appendChild(d)}});`),
  // `.newsletter-popup` here is ordinary, always-visible page content.
  "/static": SHELL("", `<section class="newsletter-popup" style="position:static;height:300px;width:auto">Join us</section>`),
  "/nothing": SHELL("", ""),
};

let server, base, browser, skipReason = "";
before(async () => {
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: true });
  } catch (e) {
    skipReason = "Chromium unavailable: " + String(e.message).split("\n")[0];
    return;
  }
  server = http.createServer((req, res) => {
    const html = PAGES[req.url.split("?")[0]];
    res.writeHead(html ? 200 : 404, { "content-type": "text/html" });
    res.end(html || "");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await browser?.close();
  server?.close();
});

async function audit(path, { exitIntent = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript({ content: GATE });
  await page.goto(base + path);
  await page.waitForTimeout(1500);
  if (exitIntent) {
    await page.evaluate(() =>
      document.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true, clientX: 600, clientY: 0 })),
    );
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => window.__ppOpenGate());
  await page.waitForFunction(
    () => (JSON.parse(localStorage.getItem("shopAuditState_v1") || "{}").currentIndex || 0) >= 1,
  );
  const popups = await page.evaluate(() => JSON.parse(localStorage.getItem("shopAuditPopups_v1") || "[]"));
  return { ctx, page, popups };
}

const visible = (page, sel) =>
  page.evaluate((s) => !!document.querySelector(s)?.getClientRects().length, sel);

// c686cae removed the popup audit block from AUDIT_SCRIPT: the POPUP_AUDIT_JS
// import, the ${POPUP_AUDIT_JS} interpolation, popStart/popPersist/popScan/
// popFlush/popupSafeOnPage and the popup lines in outputFinal() are all gone.
// The storefront therefore scans scripts only. These three assertions describe
// detection and hide-CSS behaviour that no longer exists, so they are skipped
// rather than deleted — re-enable them if the popup block comes back.
const POPUP_SCAN_REMOVED = "popup detection removed from AUDIT_SCRIPT in c686cae";

test("finds popups that are open, timed, already closed, native <dialog>, or exit-intent", async (t) => {
  if (skipReason) return t.skip(skipReason);
  if (POPUP_SCAN_REMOVED) return t.skip(POPUP_SCAN_REMOVED);
  const { ctx, popups } = await audit("/popups", { exitIntent: true });
  for (const want of [".cc-banner", "#promo-dialog", "#quickview-modal", ".newsletter-popup", ".xyz-box", ".exit-offer-modal"]) {
    assert.ok(popups.includes(want), `missing ${want}; got ${JSON.stringify(popups)}`);
  }
  await ctx.close();
});

test("never flags ordinary fixed UI: header, sticky add-to-cart, chat launcher, hero overlay, footer", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, popups } = await audit("/popups", { exitIntent: true });
  const bad = popups.filter((s) =>
    /site-header|sticky-atc|chat-launcher|banner__overlay|footer__newsletter|hero|MainContent|main|header|nav/.test(s),
  );
  assert.deepEqual(bad, []);
  await ctx.close();
});

test("hide CSS removes every popup until interaction and nothing else; they return afterwards", async (t) => {
  if (skipReason) return t.skip(skipReason);
  if (POPUP_SCAN_REMOVED) return t.skip(POPUP_SCAN_REMOVED);
  const { ctx, page, popups } = await audit("/popups", { exitIntent: true });
  await page.evaluate((sels) => {
    const st = document.createElement("style");
    st.textContent = "html:not(.interacted) :is(" + sels.join(",") + "){display:none!important}";
    document.head.appendChild(st);
  }, popups);
  for (const sel of [".cc-banner", "#promo-dialog", "#quickview-modal", ".xyz-box", ".exit-offer-modal"]) {
    assert.equal(await visible(page, sel), false, `${sel} should be hidden before interaction`);
  }
  for (const sel of ["header.site-header", ".hero", ".sticky-atc", ".chat-launcher", ".footer__newsletter", "main"]) {
    assert.equal(await visible(page, sel), true, `${sel} must stay visible`);
  }
  await page.evaluate(() => document.documentElement.classList.add("interacted"));
  assert.equal(await visible(page, ".cc-banner"), true, "popups return after interaction");
  await ctx.close();
});

test("a popup selector that matches ordinary content on another page is rejected", async (t) => {
  if (skipReason) return t.skip(skipReason);
  if (POPUP_SCAN_REMOVED) return t.skip(POPUP_SCAN_REMOVED);
  const a = await audit("/popups");
  assert.ok(a.popups.includes(".newsletter-popup"));
  const b = await audit("/static");
  const safeOnStatic = await b.page.evaluate((s) => window.__ppHelpers.popupSafeOnPage(s), ".newsletter-popup");
  assert.equal(safeOnStatic, false, "static section with the same class must veto the selector");
  const safeCookie = await b.page.evaluate((s) => window.__ppHelpers.popupSafeOnPage(s), ".cc-banner");
  assert.equal(safeCookie, true, "a selector matching nothing on a page is harmless there");
  await a.ctx.close();
  await b.ctx.close();
});

test("a page with no popups records none", async (t) => {
  if (skipReason) return t.skip(skipReason);
  const { ctx, popups } = await audit("/nothing");
  assert.deepEqual(popups, []);
  await ctx.close();
});
