import type { Browser } from "playwright";
import { buildHiddenCss } from "./script-generator.js";
import type { GateImpactEntry, LabVitalsEntry } from "./audit-report-types";
import { COLLECT_LAB_VITALS_JS } from "./audit-metrics.server";

import { logger } from "./logger.ts";
const GATE_IMPACT_TIMEOUT_MS = 60_000;
const LAB_NOISE_LCP_MS = 100;

export async function measureGateImpactOnHome(
  browser: Browser,
  homeUrl: string,
  password?: string,
  hideSelectors: string[] = [],
  deferArray: string[] = [],
  beforeVitals?: LabVitalsEntry,
): Promise<GateImpactEntry | null> {
  const path = "/";
  const profile = "mobile";
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  try {
    const page = await context.newPage();
    const hideCss = buildHiddenCss(hideSelectors);
    const deferSimInit =
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
    const gateInit = `
      window.__ppGateSim = true;
      document.documentElement.classList.add('f-interacted');
      ${hideCss ? `var s=document.createElement('style');s.id='pp-hide-lastfold';s.textContent=${JSON.stringify(hideCss)};document.head.appendChild(s);` : ""}
      ${deferSimInit}
    `;
    await page.addInitScript({ content: gateInit });
    await page.goto(homeUrl, { waitUntil: "load", timeout: GATE_IMPACT_TIMEOUT_MS });
    if (password) {
      const unlocked = await page
        .locator('input[name="password"]')
        .count()
        .then((c) => c > 0);
      if (unlocked) {
        await page.fill('input[name="password"]', password);
        await page.locator('form[action*="password"]').first().press("Enter");
        await page.goto(homeUrl, { waitUntil: "load", timeout: GATE_IMPACT_TIMEOUT_MS });
      }
    }
    const after = (await page.evaluate(COLLECT_LAB_VITALS_JS)) as LabVitalsEntry;
    const before = beforeVitals ?? after;
    const deltaLcpMs = before.lcp != null && after.lcp != null ? after.lcp - before.lcp : undefined;
    return {
      path,
      profile,
      before,
      after,
      method: "init-script-sim",
      deltaLcpMs,
      withinLabNoise: deltaLcpMs != null ? Math.abs(deltaLcpMs) < LAB_NOISE_LCP_MS : undefined,
    };
  } catch (err) {
    logger.warn("[audit] gateImpact skipped:", err instanceof Error ? err.message : err);
    return null;
  } finally {
    await context.close().catch(() => {});
  }
}
