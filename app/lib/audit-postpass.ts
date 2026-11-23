import { logger } from "./logger.ts";
import { type Page } from "playwright";
import { FOLD_HEIGHT_PX } from "./audit-core.ts";

const MAJOR_MIN_SIZE = 80;

/** Which of `selectors` match a visible, major element on this page. */
export async function selectorsVisibleOnPage(page: Page, selectors: string[]): Promise<string[]> {
  if (selectors.length === 0) return [];
  return page
    .evaluate(
      ([sels, size]) => {
        const SKIP = [
          "html",
          "body",
          "head",
          "script",
          "style",
          "link",
          "meta",
          "noscript",
          "template",
          "svg",
          "path",
          "br",
          "hr",
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
          return r.top + (window.pageYOffset || document.documentElement.scrollTop || 0);
        }
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

        const out: string[] = [];
        for (const sel of sels as string[]) {
          try {
            const els = document.querySelectorAll(sel);
            for (let i = 0; i < els.length; i++) {
              if (isFoldSensitiveTarget(els[i])) {
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

/** Runs the audit script against all discovered pages at the same time (one
 * isolated browser context per page) and merges the results:
 *  - defer list = union of every page's third-party script fragments,
 *  - hide selectors = selectors off-screen somewhere and never visible on any
 *    page (same rule the script itself applies across pages). */
/**
 * Defer tokens recorded by the PREVIOUS audit run, so this run can unify against
 * them.
 *
 * The storefront gate matches a token as an exact substring of the script URL,
 * so a build hash that changes on redeploy silently stops matching. Repeating
 * the pass catches per-request and short time-windowed variation, but three
 * passes minutes apart all hit the same build — so a deploy-time change is
 * invisible to in-run sampling. Pooling the previous run's tokens catches it.
 *
 * `AuditLog.audit_data` already holds the whole result object, and this project
 * already reads it for per-page data (see readPerPageAuditData), so no new
 * storage is involved.
 */
export async function readPriorDeferTokens(shopDomain: string): Promise<string[]> {
  try {
    const { default: prisma } = await import("../db.server");
    const log = await prisma.auditLog.findFirst({
      where: { domain: shopDomain },
      orderBy: { timestamp: "desc" },
      select: { audit_data: true },
    });
    const data = log?.audit_data as { deferArray?: unknown; deferArrayUnmerged?: unknown } | null;
    if (!data) return [];
    const pick = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return [...new Set([...pick(data.deferArrayUnmerged), ...pick(data.deferArray)])];
  } catch (err) {
    // The cross-run merge is an improvement, never a requirement: if the prior
    // report cannot be read the audit must still complete.
    logger.warn("[audit] could not read the previous report:", err);
    return [];
  }
}
