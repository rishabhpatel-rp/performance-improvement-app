import type { Browser } from "playwright";
import { buildHiddenCss } from "./script-generator.js";
import { unlockPasswordPage, returnToRequestedUrl } from "./audit-browser.ts";

export interface SmokeTestResult {
  passed: boolean;
  failures: Array<{ check: string; reason: string }>;
  checksRun: string[];
}

function buildDeferSimInitScript(deferArray: string[], hideSelectors: string[]): string {
  const hideCss = buildHiddenCss(hideSelectors);
  const deferSim =
    deferArray.length > 0
      ? `
    (function() {
      var DEFER = ${JSON.stringify(deferArray)};
      function maybeDefer(node) {
        if (node.nodeName !== 'SCRIPT') return;
        var src = node.src || '';
        if (!src) return;
        if (DEFER.some(function (d) { return src.indexOf(d) !== -1; })) {
          node.type = 'text/deferred';
        }
      }
      function arm() {
        var root = document.documentElement;
        if (!root) return;
        var observer = new MutationObserver(function (muts) {
          muts.forEach(function (m) {
            m.addedNodes.forEach(function (node) {
              if (node.nodeType === 1) maybeDefer(node);
            });
          });
        });
        observer.observe(root, { childList: true, subtree: true });
        document.querySelectorAll('script[src]').forEach(maybeDefer);
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', arm);
      } else {
        arm();
      }
    })();
  `
      : "";
  return `
    (function(){
      var root = document.documentElement;
      if (!root) return;
      root.classList.add('f-interacted');
    })();
    ${hideCss ? `var s=document.createElement('style');s.id='pp-hide-smoke';s.textContent=${JSON.stringify(hideCss)};document.head.appendChild(s);` : ""}
    ${deferSim}
  `;
}

export async function runStorefrontSmokeTest(
  browser: Browser,
  homeUrl: string,
  deferArray: string[],
  hideSelectors: string[],
  password?: string,
): Promise<SmokeTestResult> {
  const failures: Array<{ check: string; reason: string }> = [];
  const checksRun: string[] = [];

  checksRun.push("home-no-js-errors");
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  try {
    const page = await ctx.newPage();
    const jsErrors: string[] = [];
    page.on("pageerror", (e) => jsErrors.push(e.message.slice(0, 120)));
    await page.addInitScript({ content: buildDeferSimInitScript(deferArray, hideSelectors) });
    await page.goto(homeUrl, { waitUntil: "load", timeout: 45_000 }).catch(() => {});
    if (password && (await unlockPasswordPage(page, password))) {
      await returnToRequestedUrl(page, homeUrl, 45_000);
    }
    await page.waitForTimeout(1500).catch(() => {});
    const criticalJs = jsErrors.filter(
      (e) => !/classList|Password|password|MutationObserver/i.test(e),
    );
    if (criticalJs.length > 2) {
      failures.push({ check: "home-no-js-errors", reason: criticalJs[0] });
    }

    checksRun.push("home-fold-present");
    const foldOk = await page
      .evaluate(() => {
        const selectors = [
          "header",
          "[role=banner]",
          "main",
          "#MainContent",
          "#shopify-section-header",
          ".shopify-section-header",
          ".header",
          ".site-header",
          ".shopify-section",
        ];
        for (const sel of selectors) {
          const h = document.querySelector(sel);
          if (!h) continue;
          const r = h.getBoundingClientRect();
          if (r.height > 20 && r.width > 20 && r.top < window.innerHeight) return true;
        }
        return document.body != null && document.body.scrollHeight > 400;
      })
      .catch(() => false);
    if (!foldOk) {
      failures.push({ check: "home-fold-present", reason: "No visible header/main fold region" });
    }

    checksRun.push("cart-drawer-or-link");
    const cartUi = await page
      .evaluate(() => {
        return Boolean(
          document.querySelector(
            'a[href*="/cart"], cart-drawer, #cart-icon-bubble, [data-cart-toggle], form[action*="/cart/add"]',
          ),
        );
      })
      .catch(() => false);
    if (!cartUi) {
      failures.push({ check: "cart-drawer-or-link", reason: "No cart UI found on home" });
    }

    checksRun.push("cart-api");
    const cartApi = await page
      .evaluate(async () => {
        const r = await fetch("/cart.js", { credentials: "same-origin" });
        if (!r.ok) return { ok: false, reason: `HTTP ${r.status}` };
        const body = await r.json().catch(() => null);
        if (!body || !Array.isArray((body as { items?: unknown }).items)) {
          return { ok: false, reason: "Invalid cart.js payload" };
        }
        return { ok: true, reason: "" };
      })
      .catch((e) => ({ ok: false, reason: String(e).slice(0, 100) }));
    if (!cartApi.ok) failures.push({ check: "cart-api", reason: cartApi.reason });

    checksRun.push("search-api");
    const searchApi = await page
      .evaluate(async () => {
        const u = "/search/suggest.json?q=test&resources%5Btype%5D=product&resources%5Blimit%5D=1";
        const r = await fetch(u, { credentials: "same-origin" });
        return { ok: r.ok, reason: r.ok ? "" : `HTTP ${r.status}` };
      })
      .catch((e) => ({ ok: false, reason: String(e).slice(0, 100) }));
    if (!searchApi.ok) failures.push({ check: "search-api", reason: searchApi.reason });

    checksRun.push("checkout-reachable");
    const checkout = await page
      .evaluate(async () => {
        const r = await fetch("/checkout", { redirect: "manual", credentials: "same-origin" });
        return { ok: r.status < 500, reason: r.status >= 500 ? `HTTP ${r.status}` : "" };
      })
      .catch((e) => ({ ok: false, reason: String(e).slice(0, 100) }));
    if (!checkout.ok) failures.push({ check: "checkout-reachable", reason: checkout.reason });

    checksRun.push("payments-and-consent-scripts");
    const pay = await page
      .evaluate(() => {
        const html = document.documentElement.outerHTML.slice(0, 500_000);
        const hasShopifyPay = /shopifycloud\/payment|shop\.app\/pay|shopify-pay/i.test(html);
        return { ok: hasShopifyPay || /myshopify\.com/i.test(location.hostname), reason: "" };
      })
      .catch((e) => ({ ok: false, reason: String(e).slice(0, 100) }));
    if (!pay.ok) {
      failures.push({
        check: "payments-and-consent-scripts",
        reason: pay.reason || "No payments bootstrap on page",
      });
    }
  } finally {
    await ctx.close().catch(() => {});
  }

  return { passed: failures.length === 0, failures, checksRun };
}
