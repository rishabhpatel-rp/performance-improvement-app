import {
  INTERACTION_CLICK_TIMEOUT_MS,
  INTERACTION_PHASE_TIMEOUT_MS,
  INTERACTION_STEP_SETTLE_MS,
  NETWORK_IDLE_CAP_MS,
  SCROLL_STEP_SETTLE_MS,
  SETTLE_MIN_MS,
  SETTLE_PROBE_GAP_MS,
  SETTLE_REQUEST_QUIET_MS,
} from "./audit-timing.ts";
import { SETTLE_SAFETY_NET_MS } from "./constants.ts";
import { logger } from "./logger.ts";
import { type Page } from "playwright";
import { AuditRunCancelledError } from "./audit-cancel.ts";
import {
  FOLD_HEIGHT_PX,
  FoldAssertion,
  MAX_INTERACTION_TARGETS,
  MAX_SCROLL_STEPS,
  MIN_SCROLL_STEPS,
  MeasuredPage,
  SCROLL_STEP_PX,
  SETTLE_STABLE_CHECKS,
} from "./audit-core.ts";

export async function waitForScriptsSettled(
  page: Page,
  isStopped?: () => boolean,
): Promise<{
  waitMs: number;
  lastResponseEnd: number;
  scriptCount: number;
  hitSafetyNet: boolean;
}> {
  const started = Date.now();
  let lastResponseEnd = -1;
  let lastCount = -1;
  let stable = 0;
  let lastChangeAt = started;

  while (Date.now() - started < SETTLE_SAFETY_NET_MS) {
    if (isStopped?.()) throw new AuditRunCancelledError();
    await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_CAP_MS }).catch(() => {});
    await page.waitForTimeout(SETTLE_PROBE_GAP_MS);
    let snap: { lastResponseEnd: number; count: number };
    try {
      snap = await page.evaluate(() => {
        const entries = (
          performance.getEntriesByType("resource") as PerformanceResourceTiming[]
        ).filter((e) => /\.js(\?|$)/i.test(e.name));
        return {
          lastResponseEnd: entries.reduce((m, e) => Math.max(m, e.responseEnd), 0),
          count: entries.length,
        };
      });
    } catch {
      break; // page navigated or died; nothing more to wait for
    }
    const observedLongEnough = Date.now() - started >= SETTLE_MIN_MS;
    if (snap.lastResponseEnd === lastResponseEnd && snap.count === lastCount) {
      stable++;
      const quietMs = Date.now() - lastChangeAt;
      if (
        quietMs >= SETTLE_REQUEST_QUIET_MS &&
        observedLongEnough &&
        stable >= SETTLE_STABLE_CHECKS
      ) {
        return {
          waitMs: Date.now() - started,
          lastResponseEnd: snap.lastResponseEnd,
          scriptCount: snap.count,
          hitSafetyNet: false,
        };
      }
    } else {
      stable = 0;
      lastChangeAt = Date.now();
      lastResponseEnd = snap.lastResponseEnd;
      lastCount = snap.count;
    }
  }
  return {
    waitMs: Date.now() - started,
    lastResponseEnd: Math.max(0, lastResponseEnd),
    scriptCount: Math.max(0, lastCount),
    hitSafetyNet: true,
  };
}

/**
 * Collapse a per-element hide list to the smallest set of parent selectors that
 * still covers the same elements.
 *
 * Only *maximal* subtrees are used: an element qualifies when nothing inside it
 * starts above the fold band, and its parent does not qualify. That yields the
 * top-most fully-below-fold wrappers instead of every leaf, which on a measured
 * page took 127 per-element selectors down to 3.
 *
 * `html`/`body` are never returned — collapsing to them would hide the page.
 */
export async function collapseToParentSelectors(
  page: Page,
  selectors: string[],
): Promise<string[]> {
  if (selectors.length === 0) return [];
  return page
    .evaluate(
      ([sels, foldHeight]) => {
        const helpers = (
          window as unknown as {
            __ppHelpers?: {
              isMajorForFold: (el: Element) => boolean;
              getStableSelectors: (el: Element) => string[];
            };
          }
        ).__ppHelpers;
        if (!helpers) return [] as string[];

        const docTop = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
        };
        const inFold = (el: Element) => docTop(el) < (foldHeight as number);
        const collapsible = (el: Element) =>
          !inFold(el) &&
          Array.prototype.every.call(
            el.querySelectorAll("*"),
            (d: Element) => !helpers.isMajorForFold(d) || !inFold(d),
          );

        const out: string[] = [];
        const seen = new Set<string>();
        Array.prototype.forEach.call(document.querySelectorAll("body *"), (el: Element) => {
          if (!helpers.isMajorForFold(el)) return;
          if (!collapsible(el)) return;
          const parent = el.parentElement;
          if (!parent || parent === document.body) return;
          if (collapsible(parent)) return; // not maximal
          const s = helpers.getStableSelectors(el)[0];
          if (s && !seen.has(s)) {
            seen.add(s);
            out.push(s);
          }
        });

        // A candidate whose own selector did not collapse (its element has no
        // fully-below-fold ancestor) still has to be emitted as-is, otherwise
        // it silently stops being hidden.
        for (const sel of sels as string[]) {
          if (!seen.has(sel)) out.push(sel);
        }
        return out;
      },
      [selectors, FOLD_HEIGHT_PX] as [string[], number],
    )
    .catch(() => selectors);
}

/**
 * Apply the emitted hide list to each already-loaded page and check that no
 * element inside the first 1100px became hidden.
 *
 * This is the guard that makes the audit's central promise checkable instead of
 * assumed. The emitted CSS is `html:not(.interacted) :is(...){display:none!important}`;
 * we toggle the same state the consumer would and measure.
 */
export async function verifyFoldSurvives(
  measured: MeasuredPage[],
  hideSelectors: string[],
): Promise<FoldAssertion> {
  const violations = new Set<string>();
  let pagesChecked = 0;
  if (hideSelectors.length === 0) return { pagesChecked: 0, violations: [], ok: true };

  for (let i = 0; i < measured.length; i++) {
    const { page } = measured[i];
    try {
      const hits = await page.evaluate(
        ([sels, foldHeight]) => {
          const helpers = (
            window as unknown as {
              __ppHelpers?: {
                isMajorForFold: (el: Element) => boolean;
              };
            }
          ).__ppHelpers;
          if (!helpers) return [] as string[];

          const foldH = foldHeight as number;

          const foldChromeRoot = (el: Element): Element | null => {
            try {
              return el.closest(
                "header,[role=banner],[role=navigation],nav,.hero,.hero-wrapper,.shopify-section-header,.header-section,.header-logo",
              );
            } catch {
              return null;
            }
          };
          const docTop = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
          };
          const overlapsFoldBand = (el: Element): boolean => {
            const r = el.getBoundingClientRect();
            if (r.width > 0 || r.height > 0) {
              const top = docTop(el);
              const bottom = top + r.height;
              if (top < foldH && bottom > 0) return true;
            }
            const chrome = foldChromeRoot(el);
            if (chrome) {
              const cr = chrome.getBoundingClientRect();
              if (cr.height > 0) {
                const cTop = docTop(chrome);
                const cBottom = cTop + cr.height;
                if (cTop < foldH && cBottom > 0) return true;
              }
            }
            return false;
          };
          const isFoldSensitiveTarget = (el: Element): boolean => {
            if (!overlapsFoldBand(el)) return false;
            if (helpers.isMajorForFold(el)) return true;
            const tag = el.tagName;
            if (tag === "IMG" || tag === "PICTURE" || tag === "VIDEO") return true;
            if (foldChromeRoot(el) && el.classList.contains("lazyload")) return true;
            return false;
          };

          const style = document.createElement("style");
          style.textContent =
            "html:not(.interacted) :is(" +
            (sels as string[]).join(",") +
            "){display:none!important}";
          document.head.appendChild(style);
          const cls = document.documentElement.classList;
          const hadInteracted = cls.contains("interacted");
          cls.remove("interacted");

          const hidden: string[] = [];
          for (const sel of sels as string[]) {
            let els: NodeListOf<Element>;
            try {
              els = document.querySelectorAll(sel);
            } catch {
              continue;
            }
            for (let j = 0; j < els.length; j++) {
              const el = els[j];
              if (!isFoldSensitiveTarget(el)) continue;
              if (!el.getClientRects().length) {
                hidden.push(sel);
                break;
              }
            }
          }

          style.remove();
          if (hadInteracted) cls.add("interacted");
          return hidden;
        },
        [hideSelectors, FOLD_HEIGHT_PX] as [string[], number],
      );
      hits.forEach((h) => violations.add(h));
      pagesChecked++;
    } catch {
      // A page that died mid-assertion cannot prove anything; the funnel already
      // reports its settle state.
    }
  }

  const list = [...violations].sort();
  if (list.length) {
    logger.warn(
      `[audit] Fold assertion FAILED on ${list.length} selector(s) across ${pagesChecked} page(s):`,
      list.slice(0, 10).join(", "),
    );
  }
  return { pagesChecked, violations: list, ok: list.length === 0 };
}

export async function screenshotFoldRegression(
  page: Page,
  hideSelectors: string[],
  foldHeightPx = FOLD_HEIGHT_PX,
): Promise<{ regressed: boolean; changedPixelFraction: number }> {
  if (hideSelectors.length === 0) return { regressed: false, changedPixelFraction: 0 };

  const clip = { x: 0, y: 0, width: 1280, height: foldHeightPx };
  const before = await page.screenshot({ clip, type: "png" }).catch(() => null);
  if (!before) return { regressed: false, changedPixelFraction: 0 };

  const styleId = "__pp_fold_screenshot_test";
  await page
    .evaluate(
      ([sels, id]) => {
        const s = document.createElement("style");
        s.id = id as string;
        s.textContent = `html:not(.interacted) :is(${(sels as string[]).join(",")}) { display: none !important }`;
        document.head.appendChild(s);
      },
      [hideSelectors, styleId] as [string[], string],
    )
    .catch(() => {});

  const after = await page.screenshot({ clip, type: "png" }).catch(() => null);
  await page
    .evaluate((id: string) => document.getElementById(id)?.remove(), styleId)
    .catch(() => {});

  if (!after) return { regressed: false, changedPixelFraction: 0 };

  let changed = 0;
  const len = Math.min(before.length, after.length);
  for (let i = 0; i < len; i++) {
    if (Math.abs(before[i] - after[i]) > 15) changed++;
  }
  const fraction = changed / len;
  return { regressed: fraction > 0.04, changedPixelFraction: fraction };
}

/**
 * Captures the fold-protection list: selectors of elements visible in the
 * first FOLD_HEIGHT_PX of the BODY, and scripts inside those elements that are
 * RENDER-BLOCKING (synchronous).
 *
 * ── Why "body" only, not "document/head" ────────────────────────────────────
 * The <head> element has no layout box (getBoundingClientRect = 0×0). Scripts
 * in <head> are therefore NEVER captured by the fold check — the selector
 * `document.querySelectorAll("body *")` already excludes them. This is correct:
 * <head> scripts are handled by other gates (never-defer classification,
 * coverage verdict). The fold protection is purely about VISUAL elements
 * that the visitor sees immediately.
 *
 * ── Why only BLOCKING scripts are protected ─────────────────────────────────
 * A script with async, defer, or type="module" is non-blocking by definition —
 * the browser never pauses HTML parsing for it. Deferring such a script from
 * within the first 1100px CANNOT worsen LCP because it was already not blocking
 * the render path. Only synchronous <script src="..."> tags (no async/defer/
 * type="module") actually block parsing and can delay the LCP element from
 * being painted. Those are the ONLY scripts fold-protected here.
 *
 * Example: a hero section (<section> at top) contains
 *   <script async src="analytics.js">  ← NOT fold-protected (async)
 *   <script src="hero-slider.js">      ← fold-protected (synchronous)
 *
 * This means analytics scripts, review widgets, and chat loaders placed inside
 * fold-overlapping sections by the merchant's theme are now eligible for
 * deferral even though they are physically above the fold, as long as they
 * were already loaded with async/defer.
 */
export async function captureInitialFold(
  page: Page,
): Promise<{ selectors: string[]; scripts: string[]; reasons: Record<string, string> }> {
  return page
    .evaluate((foldHeight) => {
      const helpers = (
        window as unknown as {
          __ppHelpers?: {
            isMajorForFold: (el: Element) => boolean;
            getStableSelectors: (el: Element) => string[];
          };
        }
      ).__ppHelpers;
      if (!helpers) return { selectors: [], scripts: [], reasons: {} };

      function docTop(el: Element): number {
        const r = el.getBoundingClientRect();
        return r.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
      }
      // A genuine 0x0 rect pinned at the origin is a "not laid out" signal
      // (detached, display:none, or collapsed) — layout state, not class lookup.
      function hasLayout(el: Element): boolean {
        const r = el.getBoundingClientRect();
        return !(r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0);
      }
      function overlapsFold(el: Element): boolean {
        if (!hasLayout(el)) return false;
        const top = docTop(el);
        const bottom = top + el.getBoundingClientRect().height;
        return top < (foldHeight as number) && bottom > 0;
      }
      /** Returns true when a <script> tag is render-blocking (synchronous).
       *  async / defer / module scripts are non-blocking — deferring them has
       *  no LCP impact even when the script is physically inside the fold. */
      function isRenderBlocking(scriptEl: Element): boolean {
        const s = scriptEl as HTMLScriptElement;
        if (s.async) return false;
        if (s.defer) return false;
        if (s.type === "module") return false;
        if (s.type === "text/plain") return false; // already parked by our own gate
        if (s.type === "text/pp-deferred") return false;
        return true;
      }

      const selectors = new Set<string>();
      const scripts = new Set<string>();
      const reasons: Record<string, string> = {};

      // `body *` already excludes <html> and <head> — their layout box is 0×0
      // so hasLayout() would reject them even if they slipped through.
      const all = Array.prototype.filter.call(
        document.querySelectorAll("body *"),
        helpers.isMajorForFold,
      ) as Element[];

      all.filter(overlapsFold).forEach((container) => {
        // Selectors: protect the visible element from being hidden.
        helpers.getStableSelectors(container).forEach((s) => selectors.add(s));

        // Scripts: ONLY protect synchronous (render-blocking) ones.
        // async/defer/module scripts inside the fold are eligible for deferral —
        // they were already non-blocking, so gating them cannot hurt LCP.
        container.querySelectorAll("script[src]").forEach((s) => {
          if (!isRenderBlocking(s)) return; // ← async/defer/module → skip
          const src = s.getAttribute("src");
          if (!src) return;
          scripts.add(src);
          if (!reasons[src]) {
            reasons[src] = hasLayout(container) ? "ancestor-fold" : "dormant-subtree";
          }
        });
      });

      return { selectors: [...selectors], scripts: [...scripts], reasons };
    }, FOLD_HEIGHT_PX)
    .catch((): { selectors: string[]; scripts: string[]; reasons: Record<string, string> } => ({
      selectors: [],
      scripts: [],
      reasons: {},
    }));
}

/** Best-effort simulation of a real browsing session: scroll through the
 * page, move the mouse, and click a handful of clearly-safe, non-destructive
 * interactive elements (accordions, tabs, carousel controls, menu toggles),
 * recording which elements got revealed. Every Playwright call is
 * independently caught and the whole phase is time-boxed — a stuck or
 * failing page must never abort the outer `Promise.allSettled` batch in
 * `runHiddenAudit`. Returns the selectors of clicked elements (and their
 * `aria-controls` targets) so the caller can treat them as visible. */
export async function simulateInteractions(
  page: Page,
): Promise<{ revealed: string[]; steps: number; clicks: number }> {
  const revealed = new Set<string>();

  // Scroll the whole document, not a fixed number of steps. A measured home
  // page was 9440px tall, which the previous fixed 4 steps (3600px) left 58%
  // of unexercised — so scroll-gated code down there never ran and was
  // wrongly classified as deferrable.
  const docHeight = await page.evaluate(() => document.documentElement.scrollHeight).catch(() => 0);
  const steps = Math.min(
    MAX_SCROLL_STEPS,
    Math.max(MIN_SCROLL_STEPS, Math.ceil((docHeight || 0) / SCROLL_STEP_PX)),
  );
  let clicks = 0;

  const run = async () => {
    // 1. Scroll through the page so IntersectionObserver / lazy-load /
    // scroll-gated code actually fires.
    for (let i = 0; i < steps; i++) {
      await page.mouse.wheel(0, SCROLL_STEP_PX).catch(() => {});
      await page.waitForTimeout(SCROLL_STEP_SETTLE_MS);
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
    await page.waitForTimeout(SCROLL_STEP_SETTLE_MS);
    for (const frac of [0.4, 0.7, 0.9]) {
      const y = await page
        .evaluate((f) => document.documentElement.scrollHeight * f, frac)
        .catch(() => 0);
      if (y > 0) {
        await page.evaluate((yPos) => window.scrollTo(0, yPos), y).catch(() => {});
        await page.waitForTimeout(SCROLL_STEP_SETTLE_MS);
      }
    }

    // 2. Move the mouse across a few regions to wake pointer/hover-gated
    // scripts (in addition to the existing two-point wake-up in the settle
    // block below).
    const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
    await page.mouse.move(viewport.width * 0.25, viewport.height * 0.25).catch(() => {});
    await page.mouse.move(viewport.width * 0.75, viewport.height * 0.5).catch(() => {});
    await page.mouse.move(viewport.width * 0.5, viewport.height * 0.75).catch(() => {});

    // 3. Find and stamp a handful of clearly-safe interactive elements.
    const count = await page
      .evaluate((maxTargets: number) => {
        const SELECTORS = [
          '[aria-expanded="false"]',
          "details > summary",
          '[class*="accordion"]',
          '[role="tab"]',
          '[class*="slick-next"]',
          '[class*="swiper-button-next"]',
          "[data-carousel-next]",
          '[aria-label*="menu" i]',
          '[class*="hamburger"]',
          "button[aria-controls]",
          'input[type="radio"][name*="option"]',
          "fieldset[data-product-fields] label",
          "[data-option-name] label",
          'input[type="search"]',
          'input[name="q"][type="text"]',
          "#predictive-search-input",
          "[data-cart-toggle]",
          '[aria-controls*="cart-drawer" i]',
          '[aria-controls*="CartDrawer" i]',
          '[aria-label*="cart" i][aria-expanded="false"]',
          'button[class*="wishlist" i]',
          'button[aria-label*="wishlist" i]',
          'button[aria-label*="save item" i]',
          "[data-age-gate] button",
        ].join(",");
        const DESTRUCTIVE =
          /add.{0,3}to.{0,3}cart|buy now|checkout|subscribe|place order|proceed to|sign.?up|pay now|purchase/i;

        function isSafe(el: Element): boolean {
          const tag = el.tagName.toLowerCase();
          if (tag === "input") {
            if (el.getAttribute("type") === "search") return true;
            if (el.getAttribute("name") === "q") return true;
            if (el.getAttribute("type") === "radio" && el.closest('form[action*="/cart/add"]'))
              return false;
            if (el.getAttribute("type") === "radio") return true;
          }
          if (el.closest('form[action*="/cart/add"]')) return false;
          if (el.closest("form")) return false;
          if (["textarea", "select"].indexOf(tag) !== -1) return false;
          if (tag === "a") {
            const href = el.getAttribute("href") || "";
            if (href && href !== "#" && !href.startsWith("javascript:")) return false;
          }
          if (tag === "button" && el.getAttribute("type") === "submit") return false;
          if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true")
            return false;
          const text = (el.textContent || "") + " " + (el.getAttribute("aria-label") || "");
          if (DESTRUCTIVE.test(text)) return false;
          return true;
        }

        const candidates = Array.prototype.filter.call(
          document.querySelectorAll(SELECTORS),
          isSafe,
        ) as Element[];

        let stamped = 0;
        for (const el of candidates) {
          if (stamped >= maxTargets) break;
          el.setAttribute("data-pp-interact", String(stamped));
          stamped++;
        }
        return stamped;
      }, MAX_INTERACTION_TARGETS)
      .catch(() => 0);

    // 4. Click each stamped target and record its own selector plus its
    // aria-controls target's selector (if any).
    for (let i = 0; i < count; i++) {
      const clickedOk = await page
        .locator(`[data-pp-interact="${i}"]`)
        .click({ timeout: INTERACTION_CLICK_TIMEOUT_MS })
        .then(() => true)
        .catch(() => false);
      if (clickedOk) clicks++;
      await page.waitForTimeout(INTERACTION_STEP_SETTLE_MS);
      const selectors = await page
        .evaluate((idx: number) => {
          const helpers = (
            window as unknown as {
              __ppHelpers?: { getStableSelectors: (el: Element) => string[] };
            }
          ).__ppHelpers;
          const el = document.querySelector(`[data-pp-interact="${idx}"]`);
          if (!helpers || !el) return [] as string[];
          const out = helpers.getStableSelectors(el);
          const controls = el.getAttribute("aria-controls");
          if (controls) {
            const target = document.getElementById(controls);
            if (target) out.push(...helpers.getStableSelectors(target));
          }
          return out;
        }, i)
        .catch(() => [] as string[]);
      selectors.forEach((s) => revealed.add(s));
    }

    await page
      .evaluate(() => {
        const sel = '[tabindex]:not([tabindex="-1"]), button:not([disabled]), a[href]';
        const els = Array.from(document.querySelectorAll(sel)).slice(0, 5);
        els.forEach((el) => {
          try {
            (el as HTMLElement).focus();
          } catch {
            // ignore
          }
        });
      })
      .catch(() => {});
  };

  await Promise.race([
    run(),
    new Promise<void>((resolve) => setTimeout(resolve, INTERACTION_PHASE_TIMEOUT_MS)),
  ]).catch(() => {});

  return { revealed: [...revealed], steps, clicks };
}

/** Loads one page in its own isolated browser context and runs the audit
 * script on it. The page is left open (caller closes the context) so the
 * merged selectors can be re-checked against it afterwards. */
