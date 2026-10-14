import type { Browser, BrowserContext, Page } from "playwright";
import { buildGatedSinglePageAuditScript } from "./audit-script";
import { coverageVerdict, urlToCandidates, type CoverageEntry } from "./audit-candidates";
import type { LabVitalsEntry } from "./audit-report-types";
import { COLLECT_LAB_VITALS_JS, applyMobileLabThrottling } from "./audit-metrics.server";
import {
  FOLD_HEIGHT_PX,
  MEASURE_TIMEOUT_MS,
  NETWORK_IDLE_CAP_MS,
  PAGE_LOAD_TIMEOUT_MS,
  POPUP_WATCH_MS,
  SCROLL_STEP_PX,
  SETTLE_MIN_MS,
  SETTLE_PROBE_GAP_MS,
  SETTLE_SAFETY_NET_MS,
  SETTLE_STABLE_CHECKS,
} from "./audit-run-page-timing";
import {
  PAGEPULSE_AUDIT_UA,
  unlockPasswordPage,
  returnToRequestedUrl,
  isPasswordPage,
  isRealScriptUrl,
  safePathname,
  type FoldAssertion,
  type SettleReport,
} from "./audit-core.server";

type ScriptCoverageEntry = CoverageEntry & { url: string };

const STORE_KEY = "shopAuditState_v1";
const P_KEY = "shopAuditP_v1";
const VIS_KEY = "shopAuditVisible_v1";
const OFF_KEY = "shopAuditOff_v1";
const POPUP_KEY = "shopAuditPopups_v1";

// Interaction-simulation timing. Runs before the settle block above, so it
// adds to (not replaces) the existing per-page budget.
/** Hard floor on scroll steps. The real count is derived from the document
 *  height — the previous fixed 4 steps covered 3600px, which is only 38% of a
 *  measured 9440px home page, so scroll-gated code in the lower two thirds
 *  never ran. */
const MIN_SCROLL_STEPS = 6;
const MAX_SCROLL_STEPS = 40; // a pathological page must not stall the audit
const SCROLL_STEP_SETTLE_MS = 300;
const MAX_INTERACTION_TARGETS = 25; // 25 safe targets existed on a measured page
const INTERACTION_CLICK_TIMEOUT_MS = 1500; // per-click actionability timeout
const INTERACTION_STEP_SETTLE_MS = 400; // pause after each click
const INTERACTION_PHASE_TIMEOUT_MS = 30000; // hard cap: scroll + mouse + click

/** How many times the whole page set is measured in one audit run.
 *
 *  Rationale: the storefront gate matches defer tokens as an EXACT substring of
 *  the script URL, so a token carrying a value that varies per request (nonce,
 *  A/B bucket, cache-buster) or that changes between deploys stops matching and
 *  the script is silently never deferred.
 *
 *  `mergeSlugVariants` already unifies divergent variants of one script to their
 *  longest common prefix, but with a single pass there is only ever ONE variant per
 *  script, so the merge is a no-op. Repeating the pass feeds it the divergence it
 *  was written to consume. Identical repeats stay verbatim, so a stable value is
 *  never over-stripped.
 */
export const AUDIT_REPEAT_PASSES = 3;

/**
 * Gap between passes, in ms.
 *
 * Set to 0 deliberately. The gap was two minutes of pure sleeping -- roughly
 * half the wall time -- and it only bought ONE class: a value that rotates on a
 * window shorter than the gap. The classes that actually cost deferral are
 * covered elsewhere:
 *   - per-request nonces / A-B / cache-busters are caught by repeat samples
 *     alone, with no delay between them,
 *   - deploy-time build hashes are caught for free by the cross-run merge
 *     against the previous AuditLog row.
 * A rotation window longer than an audit run is not observable by any in-run
 * sampling, so a large gap bought very little for a very large cost.
 */
export const AUDIT_PASS_GAP_MS = 0;

interface PageAccumulators {
  p: string[];
  vis: string[];
  off: string[];
  /** Selectors of popups seen on this page (open now, opened later, or opened
   *  and already closed). */
  popups: string[];
  /** Kept-tokens required by fold-overlapping DOM, with the reason recorded so
   *  the blast radius of over-protection is visible per store. */
  foldScripts: string[];
  foldReasons: Record<string, string>;
  /** Ran at least one named function before interaction -> protect. */
  coverageRan: string[];
  /** Loaded but exposes no named function. Coverage genuinely cannot tell
   *  "did nothing" from "did everything" for a purely top-level script, so
   *  this is treated as unknown -> protect. */
  coverageUnknown: string[];
  neverDefer: string[];
  noise: string[];
  selfScripts: string[];
  sources: ScriptSourceCounts;
  settle: SettleReport;
}

interface ScriptSourceCounts {
  /** Authoritative: every script request Playwright saw for this page. */
  request: number;
  /** `document.querySelectorAll('script[src]')` inside the page. */
  dom: number;
  /** `performance.getEntriesByType('resource')` filtered to scripts. */
  resourceTiming: number;
  /** Tokens present in the request log but missing from an in-page source. */
  requestOnly: number;
  /** In-page sources disagreed with each other. */
  disagreement: number;
}

function emptyAccumulators(): PageAccumulators {
  return {
    p: [],
    vis: [],
    off: [],
    popups: [],
    foldScripts: [],
    foldReasons: {},
    coverageRan: [],
    coverageUnknown: [],
    neverDefer: [],
    noise: [],
    selfScripts: [],
    sources: {
      request: 0,
      dom: 0,
      resourceTiming: 0,
      requestOnly: 0,
      disagreement: 0,
    },
    settle: {
      lastScriptResponseEnd: 0,
      preInteractionWaitMs: 0,
      postInteractionWaitMs: 0,
      postInteractionDelta: 0,
      scrollSteps: 0,
      clicks: 0,
      hitSafetyNet: false,
    },
  };
}

export interface MeasuredPage {
  context: BrowserContext;
  page: Page;
  acc: PageAccumulators;
  /** Still on the storefront password page (none saved, or it was wrong). */
  blocked?: boolean;
  labVitals?: LabVitalsEntry;
  resourceRows?: Array<{
    url: string;
    transferSize?: number;
    encodedBodySize?: number;
    duration?: number;
    pathname: string;
    requestOrder?: number;
    startTime?: number;
  }>;
}

/**
 * Wait until the page has genuinely finished loading its scripts.
 *
 * `networkidle` is deliberately NOT the exit condition: on stores with
 * long-polling analytics it never fires, so a capped `networkidle` measures a
 * page that is still loading. Instead we track `max(responseEnd)` across script
 * resource entries and require it to stop moving across consecutive probes.
 * `NETWORK_IDLE_CAP_MS` only bounds each individual quiet-period probe so a page
 * that never goes quiet still gets probed, and `SETTLE_SAFETY_NET_MS` is a
 * guard against a pathological page rather than the normal exit.
 */
async function waitForScriptsSettled(
  page: Page,
): Promise<{ waitMs: number; lastResponseEnd: number; scriptCount: number; hitSafetyNet: boolean }> {
  const started = Date.now();
  let lastResponseEnd = -1;
  let lastCount = -1;
  let stable = 0;

  while (Date.now() - started < SETTLE_SAFETY_NET_MS) {
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
      if (stable >= SETTLE_STABLE_CHECKS && observedLongEnough) {
        return {
          waitMs: Date.now() - started,
          lastResponseEnd: snap.lastResponseEnd,
          scriptCount: snap.count,
          hitSafetyNet: false,
        };
      }
    } else {
      stable = 0;
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
          // Record which fold elements are visible now, then apply the CSS the
          // consumer would apply, then look again. Anything that disappeared
          // inside the band is a violation.
          const helpers = (
            window as unknown as {
              __ppHelpers?: {
                isMajorForFold: (el: Element) => boolean;
                isVisible: (el: Element) => boolean;
              };
            }
          ).__ppHelpers;
          if (!helpers) return [] as string[];

          const docTop = (el: Element) => {
            const r = el.getBoundingClientRect();
            return r.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
          };
          const foldMajor = Array.prototype.filter.call(
            document.querySelectorAll("body *"),
            helpers.isMajorForFold,
          ).filter((el: Element) => docTop(el) < (foldHeight as number));

          const before = new Set<Element>();
          foldMajor.forEach((el: Element) => {
            if (helpers.isVisible(el)) before.add(el);
          });

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
              continue; // invalid selector
            }
            for (let j = 0; j < els.length; j++) {
              const el = els[j];
              if (!before.has(el)) continue;
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
    console.warn(
      `[audit] Fold assertion FAILED on ${list.length} selector(s) across ${pagesChecked} page(s):`,
      list.slice(0, 10).join(", "),
    );
  }
  return { pagesChecked, violations: list, ok: list.length === 0 };
}

/** Everything inside the first FOLD_HEIGHT_PX of the *document* (not the
 * current scroll viewport) is treated as always-required, regardless of what
 * the interaction phase later reveals or the off-screen check later hides:
 * it's what a visitor sees immediately without scrolling. Uses only raw
 * layout geometry (`getBoundingClientRect`) — never className or
 * getComputedStyle — so it can't be fooled by `.hidden`/`.d-none`-style
 * conventions and doesn't duplicate the off-screen script's own
 * display/visibility check (that check stays exclusive to `isMajor`). */
async function captureInitialFold(
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
        return (
          r.top + (window.pageYOffset || document.documentElement.scrollTop || 0)
        );
      }
      // A genuine 0x0 rect pinned at the origin is a "not laid out" signal
      // (detached, display:none, or collapsed) — this is layout state, not a
      // style/class lookup, so filtering it out here doesn't reintroduce the
      // className/computed-style checks the requirement rules out.
      function hasLayout(el: Element): boolean {
        const r = el.getBoundingClientRect();
        return !(r.width === 0 && r.height === 0 && r.top === 0 && r.left === 0);
      }
      function overlapsFold(el: Element): boolean {
        if (!hasLayout(el)) return false;
        const top = docTop(el);
        const bottom = top + el.getBoundingClientRect().height;
        return top < foldHeight && bottom > 0;
      }

      const selectors = new Set<string>();
      const scripts = new Set<string>();
      const reasons: Record<string, string> = {};
      const all = Array.prototype.filter.call(
        document.querySelectorAll("body *"),
        helpers.isMajorForFold,
      ) as Element[];

      // Every fold-overlapping element protects its own selector AND its
      // subtree's <script src> tags — so an inactive carousel slide or an
      // unopened tab panel inside a fold-overlapping container is protected
      // even though it currently has no layout box of its own.
      //
      // The reason is recorded per script because this rule is deliberately
      // conservative: a section that merely *straddles* the 1100px line
      // protects its whole subtree, so a store can end up with far less
      // deferral than expected. Being able to see "protected because an
      // ancestor straddles the fold" is what makes that diagnosable.
      all.filter(overlapsFold).forEach((container) => {
        helpers.getStableSelectors(container).forEach((s) => selectors.add(s));
        container.querySelectorAll("script[src]").forEach((s) => {
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
    .catch(
      (): { selectors: string[]; scripts: string[]; reasons: Record<string, string> } => ({
        selectors: [],
        scripts: [],
        reasons: {},
      }),
    );
}

/** Best-effort simulation of a real browsing session: scroll through the
 * page, move the mouse, and click a handful of clearly-safe, non-destructive
 * interactive elements (accordions, tabs, carousel controls, menu toggles),
 * recording which elements got revealed. Every Playwright call is
 * independently caught and the whole phase is time-boxed — a stuck or
 * failing page must never abort the outer `Promise.allSettled` batch in
 * `runHiddenAudit`. Returns the selectors of clicked elements (and their
 * `aria-controls` targets) so the caller can treat them as visible. */
async function simulateInteractions(page: Page): Promise<{ revealed: string[]; steps: number; clicks: number }> {
  const revealed = new Set<string>();

  // Scroll the whole document, not a fixed number of steps. A measured home
  // page was 9440px tall, which the previous fixed 4 steps (3600px) left 58%
  // of unexercised — so scroll-gated code down there never ran and was
  // wrongly classified as deferrable.
  const docHeight = await page
    .evaluate(() => document.documentElement.scrollHeight)
    .catch(() => 0);
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
        ].join(",");
        const DESTRUCTIVE =
          /add.{0,3}to.{0,3}cart|buy now|checkout|subscribe|place order|proceed to|sign.?up|pay now|purchase/i;

        function isSafe(el: Element): boolean {
          if (el.closest("form")) return false;
          const tag = el.tagName.toLowerCase();
          if (["input", "textarea", "select"].indexOf(tag) !== -1) return false;
          if (tag === "a") {
            const href = el.getAttribute("href") || "";
            if (href && href !== "#" && !href.startsWith("javascript:")) return false;
          }
          if (tag === "button" && el.getAttribute("type") === "submit") return false;
          if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true")
            return false;
          const text =
            (el.textContent || "") + " " + (el.getAttribute("aria-label") || "");
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
  };

  await Promise.race([
    run(),
    new Promise<void>((resolve) => setTimeout(resolve, INTERACTION_PHASE_TIMEOUT_MS)),
  ]).catch(() => {});

  return { revealed: [...revealed], steps, clicks };
}

/** Provoke exit-intent popups, then watch the page for POPUP_WATCH_MS so popups
 * that open on a timer are on record before the audit script measures. The
 * recording itself is done inside the page by the audit script's popup block. */
async function watchForPopups(page: Page): Promise<void> {
  try {
    await page.evaluate(() => {
      // Exit intent: the pointer leaving through the top of the viewport.
      const opts = { bubbles: true, cancelable: true, clientX: 600, clientY: 0 };
      document.dispatchEvent(new MouseEvent("mouseleave", opts));
      document.documentElement.dispatchEvent(new MouseEvent("mouseleave", opts));
      document.dispatchEvent(new MouseEvent("mouseout", { ...opts, relatedTarget: null }));
    });
  } catch {
    // best effort
  }
  await page.waitForTimeout(POPUP_WATCH_MS).catch(() => {});
}

/** Of `selectors`, those that on THIS page match only popup-like elements (or
 * nothing at all). A selector that matches ordinary content here, such as a
 * `.modal` class reused by a static section, must never be hidden. */
export async function popupSelectorsSafeOnPage(
  page: Page,
  selectors: string[],
): Promise<string[]> {
  if (selectors.length === 0) return [];
  return page
    .evaluate((sels) => {
      const helpers = (
        window as unknown as {
          __ppHelpers?: { popupSafeOnPage: (sel: string) => boolean };
        }
      ).__ppHelpers;
      if (!helpers || !helpers.popupSafeOnPage) return [] as string[];
      return (sels as string[]).filter((s) => helpers.popupSafeOnPage(s));
    }, selectors)
    .catch(() => [] as string[]);
}

/** Loads one page in its own isolated browser context and runs the audit
 * script on it. The page is left open (caller closes the context) so the
 * merged selectors can be re-checked against it afterwards. */
export async function measurePage(
  browser: Browser,
  url: string,
  password?: string,
  /**
   * Harvest only: collect the script NAMES this page loads and nothing else.
   *
   * Repeat passes after the first exist solely to observe token variation, and
   * the names come from the in-page `P_KEY` accumulator. Coverage, the fold
   * snapshot and the interaction pass all cost time and none of them affect a
   * name. Skipping them is therefore free precision-wise: the fold/coverage
   * filters are applied to the pooled token set afterwards, so a harvested name
   * is still filtered exactly as before.
   */
  harvestOnly = false,
): Promise<MeasuredPage> {
  const context = await browser.newContext({
    userAgent: PAGEPULSE_AUDIT_UA,
    ...(harvestOnly
      ? {}
      : {
          viewport: { width: 390, height: 844 },
          deviceScaleFactor: 2,
        }),
  });
  try {
    const page = await context.newPage();
    if (!harvestOnly) {
      await applyMobileLabThrottling(page).catch(() => {});
    }

    // Authoritative script inventory. `performance.getEntriesByType('resource')`
    // is capped at 250 entries by Chromium, and on a measured store 32 of 204
    // scripts were absent from resource timing while still being visible here
    // (Shopify Pay's arrive-server chunks, preview-bar). `script[src]` in the
    // DOM is also far smaller (~38) because most scripts arrive via preload /
    // modulepreload / dynamic import. This listener sees every request
    // regardless of any in-page buffer, so it is the source of truth and the
    // two in-page sources become a cross-check rather than the only source.
    const requestScripts = new Set<string>();
    const onRequest = (req: import("playwright").Request) => {
      const u = req.url();
      if (/\.js(\?|$)/i.test(u)) requestScripts.add(u);
    };
    page.on("request", onRequest);

    // Precise coverage must be armed before the first script is parsed.
    //
    // Playwright's `page.coverage.startJSCoverage()` is NOT sufficient here: in
    // this configuration it returns block coverage only (every entry is
    // `isBlockCoverage: true` with an empty `functionName`), so `coverageVerdict`
    // can never report `ran` and the gate has been unable to tell a script that
    // executed from one that did not. CDP's `Profiler.startPreciseCoverage`
    // with `detailed: true` returns real function-level data, which is what
    // makes the `ran` / `unknown` / `idle` split meaningful. Falls back to the
    // Playwright API if the CDP call is unavailable.
    let cdpCoverage: import("playwright").CDPSession | null = null;
    let usingPreciseCoverage = false;
      // Coverage is skipped on a harvest pass: it costs a CDP session plus a
      // stopJSCoverage round trip, and it only decides whether a token is
      // PROTECTED -- it never changes the token's name, which is the only thing
      // the repeat passes exist to observe.
      if (!harvestOnly) {
        try {
          cdpCoverage = await page.context().newCDPSession(page);
          await cdpCoverage.send("Profiler.enable");
          await cdpCoverage.send("Profiler.startPreciseCoverage", {
            detailed: true,
            allowTriggeredUpdates: false,
          });
          usingPreciseCoverage = true;
        } catch {
          await page.coverage.startJSCoverage().catch(() => {});
        }
      }
    await page.addInitScript({ content: buildGatedSinglePageAuditScript(url) });

    try {
      await page.goto(url, { waitUntil: "load", timeout: PAGE_LOAD_TIMEOUT_MS });

      // Some password-protected stores don't honor the `?password=` query
      // param on every request path, so detect the password page and submit
      // the password form directly, then return to the page we asked for.
      if (password && (await unlockPasswordPage(page, password))) {
        await returnToRequestedUrl(page, url, PAGE_LOAD_TIMEOUT_MS);
      }
    } catch (err) {
      console.log(
        `[audit] Page load failed (${new URL(url).pathname}):`,
        err instanceof Error ? err.message : err,
      );
      // A page that never rendered (DNS/connection error page) never ran the
      // audit script; skip the settle/measure waits instead of timing out.
      const scriptRan = await page
        .evaluate(
          () =>
            typeof (window as unknown as { __ppOpenGate?: unknown })
              .__ppOpenGate === "function",
        )
        .catch(() => false);
      if (!scriptRan) {
        return {
          context,
          page,
          acc: emptyAccumulators(),
        };
      }
    }

    // Still on the password page (no password saved, or the saved one did not
    // unlock it): there is nothing to measure — stop now instead of scanning it.
    if (await isPasswordPage(page)) {
      return {
        context,
        page,
        acc: emptyAccumulators(),
        blocked: true,
      };
    }

    // Let natural (non-interaction) init finish first: the `load` event only
    // means resources finished downloading, not that every above-fold widget
    // has run its init code yet (DOMContentLoaded callbacks, deferred
    // bundles, a short self-init delay are all common). Snapshotting coverage
    // before this would miss a slider that hasn't autoplayed/initialized yet
    // and wrongly treat its script as never-used.
    const preSettle = await waitForScriptsSettled(page);

    // Capture the first FOLD_HEIGHT_PX ("initial viewport") before anything
    // is touched, then stop the pre-interaction JS coverage recording — both
    // describe the page exactly as it first renders (post-settle, pre-interaction).
      const fold = harvestOnly
        ? { selectors: [] as string[], scripts: [] as string[], reasons: {} as Record<string, string> }
        : await captureInitialFold(page);

    // Read coverage now, while the page is still post-settle and
    // pre-interaction. Coverage has to be stopped here because anything the
    // interaction pass triggers would otherwise be attributed to the
    // pre-interaction state.
    let initialCoverage: ScriptCoverageEntry[] = [];
    if (usingPreciseCoverage && cdpCoverage) {
      const { result } = await cdpCoverage
        .send("Profiler.takePreciseCoverage")
        .catch(() => ({ result: [] as ScriptCoverageEntry[] }));
      initialCoverage = (result || []).filter((e) => isRealScriptUrl(e.url || ""));
      await cdpCoverage.send("Profiler.disable").catch(() => {});
    } else {
      initialCoverage = await page.coverage.stopJSCoverage().catch(() => []);
    }

    // Simulate a real browsing session (scroll, mouse movement, opening
    // menus/tabs/accordions/carousels) so lazy-loaded and interaction-gated
    // content actually renders before the page is measured.
      const interaction = harvestOnly
        ? { revealed: [] as string[], steps: 0, clicks: 0 }
        : await simulateInteractions(page);
    const revealedByInteraction = interaction.revealed;

    // Popups that open on a timer or on exit intent never show during the
    // scroll/click pass. Provoke exit intent and keep watching for a few
    // seconds so they are on record before the audit script measures. (The
    // script's own MutationObserver is what records them, even if they close
    // again before measurement.)
    if (!harvestOnly) await watchForPopups(page);

    // Let the page settle again, then assert no *new* scripts arrived because
    // of the interaction. On the measured stores this delta is 0, so nothing
    // loads late — but it is now an assertion rather than an assumption, so a
    // store that does load on interaction cannot silently lose those scripts.
    await page.mouse.move(1, 1).catch(() => {});
    await page.mouse.move(3, 3).catch(() => {});
    const postSettle = await waitForScriptsSettled(page);
    const postInteractionDelta = Math.max(0, postSettle.scriptCount - preSettle.scriptCount);
    if (postInteractionDelta > 0) {
      console.log(
        `[audit] ${new URL(url).pathname}: +${postInteractionDelta} scripts loaded after interaction`,
      );
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    // Open the gate: the audit script measures now and stores its results.
    await page
      .evaluate(() => {
        const w = window as unknown as { __ppOpenGate?: () => void };
        w.__ppOpenGate?.();
      })
      .catch(() => {});

    await page
      .waitForFunction(
        (key) => {
          try {
            const s = JSON.parse(localStorage.getItem(key) || "{}");
            return typeof s.currentIndex === "number" && s.currentIndex >= 1;
          } catch {
            return false;
          }
        },
        STORE_KEY,
        { timeout: MEASURE_TIMEOUT_MS },
      )
      .catch(() => {
        console.warn(
          `[audit] Measurement timed out for ${new URL(url).pathname}.`,
        );
      });

    const read = await page
      .evaluate(
        ([P, VIS, OFF, POP]) => {
          const load = (k: string) => {
            try {
              return JSON.parse(localStorage.getItem(k) || "[]");
            } catch {
              return [];
            }
          };
          return { p: load(P), vis: load(VIS), off: load(OFF), popups: load(POP) };
        },
        [P_KEY, VIS_KEY, OFF_KEY, POPUP_KEY],
      )
      .catch(() => ({
        p: [] as string[],
        vis: [] as string[],
        off: [] as string[],
        popups: [] as string[],
      }));

    // ---- classify every script URL exactly once, from all three sources ----
    // The request log is authoritative; the in-page DOM and resource-timing
    // views are folded in so a script the request log missed (e.g. one served
    // from a service worker) is still not silently dropped.
    const allScriptUrls = new Set<string>(requestScripts);
    const requestTokens = new Set<string>();
    for (const u of allScriptUrls) {
      const b = urlToCandidates(u, url);
      b.kept.forEach((t) => requestTokens.add(t));
      b.neverDefer.forEach((t) => requestTokens.add(t));
    }

    const inPageSources = await page
      .evaluate(() => {
        const dom: string[] = [];
        document.querySelectorAll("script[src]").forEach((s) => {
          const v = s.getAttribute("src");
          if (v) dom.push(v);
        });
        const rt = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter((e) => e.initiatorType === "script" || /\.js(\?|$)/i.test(e.name))
          .map((e) => e.name);
        return { dom, rt };
      })
      .catch(() => ({ dom: [] as string[], rt: [] as string[] }));

    const foldScripts: string[] = [];
    const foldReasons: Record<string, string> = {};
    for (const src of fold.scripts) {
      // NOTE: `getAttribute('src')` is protocol-relative (`//host/path`) for
      // Shopify theme assets, so it MUST be resolved against the page origin.
      const abs = src.startsWith("//") ? `https:${src}` : src;
      const b = urlToCandidates(abs, url);
      b.kept.forEach((t) => {
        foldScripts.push(t);
        foldReasons[t] = fold.reasons[src] || "ancestor-fold";
      });
    }

    // ---- coverage verdict: three-way, because coverage is not a boolean ----
    // A loaded script has ALWAYS executed its top-level code, so the whole-file
    // block-coverage entry (`fn: ""`) is true for every loaded script and says
    // nothing. Testing that entry alone marks every script as "used" and
    // empties deferArray. Testing only named functions instead is also wrong:
    // a purely top-level script (a custom-element definition, an IIFE that
    // wires behaviour immediately) runs real work but exposes no named
    // function, so it would be deferred. `unknown` is therefore protected.
    const coverageRan: string[] = [];
    const coverageUnknown: string[] = [];
    for (const entry of initialCoverage) {
      const verdict = coverageVerdict(entry);
      if (verdict === "idle") continue;
      const b = urlToCandidates(entry.url, url);
      b.kept.forEach((t) => {
        if (verdict === "ran") coverageRan.push(t);
        else coverageUnknown.push(t);
      });
    }

    // Fold / coverage sets can arrive in any source order, so bucket everything
    // here in one place rather than at each call site.
    const neverDefer: string[] = [];
    const noise: string[] = [];
    const selfScripts: string[] = [];
    const mergedKept = new Set<string>([...read.p, ...requestTokens]);
    for (const u of allScriptUrls) {
      const b = urlToCandidates(u, url);
      b.neverDefer.forEach((t) => neverDefer.push(t));
      b.noise.forEach((t) => noise.push(t));
      b.self.forEach((t) => selfScripts.push(t));
    }

    const inPageTokens = new Set<string>();
    for (const u of [...inPageSources.dom, ...inPageSources.rt]) {
      const abs = u.startsWith("//") ? `https:${u}` : u;
      const b = urlToCandidates(abs, url);
      b.kept.forEach((t) => inPageTokens.add(t));
    }
    const requestOnly = [...requestTokens].filter((t) => !inPageTokens.has(t)).length;
    const disagreement = [...inPageTokens].filter((t) => !requestTokens.has(t)).length;

    page.off("request", onRequest);

    const pathname = safePathname(url);
    let labVitals: LabVitalsEntry | undefined;
    let resourceRows: MeasuredPage["resourceRows"];
    if (!harvestOnly) {
      labVitals = (await page
        .evaluate(COLLECT_LAB_VITALS_JS)
        .catch(() => undefined)) as LabVitalsEntry | undefined;
      resourceRows = await page
        .evaluate((pagePath) => {
          const rows: Array<{
            url: string;
            transferSize?: number;
            encodedBodySize?: number;
            duration?: number;
            pathname: string;
            requestOrder?: number;
            startTime?: number;
          }> = [];
          const entries = performance.getEntriesByType(
            "resource",
          ) as PerformanceResourceTiming[];
          const scripts = entries
            .filter(
              (e) => e.initiatorType === "script" || /\.js(\?|$)/i.test(e.name),
            )
            .sort((a, b) => a.startTime - b.startTime);
          let order = 0;
          for (const e of scripts) {
            order += 1;
            rows.push({
              url: e.name,
              transferSize: e.transferSize,
              encodedBodySize: e.encodedBodySize,
              duration: e.duration,
              startTime: e.startTime,
              requestOrder: order,
              pathname: pagePath as string,
            });
          }
          return rows;
        }, pathname)
        .catch(() => []);
    }

    return {
      context,
      page,
      labVitals,
      resourceRows,
      acc: {
        p: [...mergedKept],
        vis: [...new Set([...read.vis, ...fold.selectors, ...revealedByInteraction])],
        off: read.off,
        popups: (read.popups as unknown[]).filter(
          (x): x is string => typeof x === "string" && x.length > 0,
        ),
        foldScripts: [...new Set(foldScripts)],
        foldReasons,
        coverageRan: [...new Set(coverageRan)],
        coverageUnknown: [...new Set(coverageUnknown)],
        neverDefer: [...new Set(neverDefer)],
        noise: [...new Set(noise)],
        selfScripts: [...new Set(selfScripts)],
        sources: {
          request: allScriptUrls.size,
          dom: inPageSources.dom.length,
          resourceTiming: inPageSources.rt.length,
          requestOnly,
          disagreement,
        },
        settle: {
          lastScriptResponseEnd: Math.round(
            Math.max(preSettle.lastResponseEnd, postSettle.lastResponseEnd),
          ),
          preInteractionWaitMs: preSettle.waitMs,
          postInteractionWaitMs: postSettle.waitMs,
          postInteractionDelta,
          scrollSteps: interaction.steps,
          clicks: interaction.clicks,
          hitSafetyNet: preSettle.hitSafetyNet || postSettle.hitSafetyNet,
        },
      },
    };
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

// Mirrors `isMajor` / `isVisible` from the audit script (audit-script.ts) so
// the check below uses exactly the same notion of "a visible section".
const MAJOR_MIN_SIZE = 80;

/** Which of `selectors` match a visible, major element on this page. */
export async function selectorsVisibleOnPage(
  page: Page,
  selectors: string[],
): Promise<string[]> {
  if (selectors.length === 0) return [];
  return page
    .evaluate(
      ([sels, size]) => {
        const SKIP = [
          "html", "body", "head", "script", "style", "link", "meta",
          "noscript", "template", "svg", "path", "br", "hr",
        ];
        const isMajor = (el: Element) => {
          if (el.nodeType !== 1) return false;
          if (SKIP.indexOf(el.tagName.toLowerCase()) !== -1) return false;
          if (!el.className && !el.id) return false;
          const cs = getComputedStyle(el);
          if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0")
            return false;
          const r = el.getBoundingClientRect();
          return !(r.width < (size as number) && r.height < (size as number));
        };
        const isVisible = (el: Element) => {
          const r = el.getBoundingClientRect();
          return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
        };
        const out: string[] = [];
        for (const sel of sels as string[]) {
          try {
            const els = document.querySelectorAll(sel);
            for (let i = 0; i < els.length; i++) {
              if (isMajor(els[i]) && isVisible(els[i])) {
                out.push(sel);
                break;
              }
            }
          } catch {
            // invalid selector on this page
          }
        }
        return out;
      },
      [selectors, MAJOR_MIN_SIZE] as [string[], number],
    )
    .catch(() => []);
}

/** Which of `selectors` match an element overlapping the first FOLD_HEIGHT_PX
 * of the document on this page — re-checked across every audited page, not
 * just the one a selector was first found "off" on (mirrors how
 * `selectorsVisibleOnPage` re-checks plain viewport visibility above). This
 * closes two gaps `captureInitialFold` can't close on its own: (1) an element
 * below the default ~800px headless viewport but still inside the 1100px
 * fold band, and (2) a *structural* off-screen selector like
 * `container > :nth-child(n+4)` — which doesn't match any single element's
 * own `getStableSelectors()` output, so it can never appear in
 * `captureInitialFold`'s per-element selector set even when the elements it
 * matches are themselves inside the fold. */
export async function selectorsOverlapFoldOnPage(
  page: Page,
  selectors: string[],
): Promise<string[]> {
  if (selectors.length === 0) return [];
  return page
    .evaluate(
      ([sels, foldHeight]) => {
        const helpers = (
          window as unknown as {
            __ppHelpers?: { isMajorForFold: (el: Element) => boolean };
          }
        ).__ppHelpers;
        if (!helpers) return [];

        function docTop(el: Element): number {
          const r = el.getBoundingClientRect();
          return (
            r.top + (window.pageYOffset || document.documentElement.scrollTop || 0)
          );
        }
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


        const out: string[] = [];
        for (const sel of sels as string[]) {
          try {
            const els = document.querySelectorAll(sel);
            for (let i = 0; i < els.length; i++) {
              if (helpers.isMajorForFold(els[i]) && overlapsFold(els[i])) {
                out.push(sel);
                break;
              }
            }
          } catch {
            // invalid selector on this page
          }
        }
        return out;
      },
      [selectors, FOLD_HEIGHT_PX] as [string[], number],
    )
    .catch(() => []);
}
