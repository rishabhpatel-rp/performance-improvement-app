import { type CoverageEntry } from "./audit-candidates";
import { AuditRunCancelledError, AuditRunTimeoutError } from "./audit-cancel.ts";
export { AuditRunCancelledError, AuditRunTimeoutError } from "./audit-cancel.ts";
import {
  type AuditReportSummary,
  AuditRunMeta,
  FieldVitalsSummary,
  GateImpactEntry,
  LabVitalsEntry,
  ScriptInventoryBlock,
} from "./audit-report-types";
import { type BrowserContext, type Page } from "playwright";

/** A `Profiler.ScriptCoverage` record: `coverageVerdict` only needs
 *  `functions`, but callers also need the `url` to map the record back to
 *  candidate tokens. */
export type ScriptCoverageEntry = CoverageEntry & { url: string };

/**
 * Only real network scripts are meaningful for deferral decisions.
 *
 * Playwright's `stopJSCoverage` already returns nothing but scripts, but CDP's
 * `Profiler.takePreciseCoverage` additionally reports `extension://`,
 * `devtools://`, `blob:` and `data:` documents. Feeding those to
 * `urlToCandidates` would mint garbage slugs for them and pollute the emitted
 * lists, so they are dropped before classification.
 */
export function isRealScriptUrl(url: string): boolean {
  return /^https?:/i.test(url) && /\.js(\?|#|$)/i.test(url);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AdminClient = any;

export interface DiscoveredPages {
  home: string;
  plp?: string;
  pdp?: string;
  /** Extra merchant-specified pages, already rewritten with the password and
   *  preview-theme params. Audited like any other page but with no PLP/PDP
   *  semantics, so they only ever contribute to the union. */
  extras?: string[];
}

export interface HiddenAuditResult {
  /** Union of every page's deferrable scripts. Kept as the union on purpose:
   *  `StoreConfig.auditDeferArray` -> `rebuildPerformanceScript` -> obfuscate
   *  -> app proxy is the existing consumer path and must not change shape. */
  deferArray: string[];
  /** Populated from audit — maps to `staticDeferDefaults` (every-load delay tier). */
  delayEveryArray?: string[];
  /** Populated from audit — maps to `firstUserDelayScripts` (first-visit delay tier). */
  delayFirstArray?: string[];
  /** Same decision, split by page pathname, for the per-page consumer rewrite.
   *  Additive: this whole object is already persisted into
   *  `AuditLog.audit_data` (`Json`), so no schema change is required. */
  deferArrayByPage: Record<string, string[]>;
  /** Pre-merge tokens, for reconciling against the funnel. */
  deferArrayUnmerged: string[];
  /** Scripts every audited page loads. The bundle ships this once. */
  deferArrayBase: string[];
  /** Per-page extras on top of `deferArrayBase`, keyed by page pathname. */
  deferArrayAddByPage: Record<string, string[]>;
  hideSelectors: string[];
  /** Per-page hide lists, keyed by the audited page's pathname. */
  hideSelectorsByPage: Record<string, string[]>;
  /** Match patterns per audited page, most specific first. The consumer walks
   *  these in order against `location.pathname` so one bundle can serve every
   *  PDP/PLP on the store, not just the three URLs the audit saw. */
  pagePatterns: Record<string, string[]>;
  /** Shopify-critical scripts recorded but never gated (`chunk*`, `storefront*`). */
  neverDefer: string[];
  /** The app's own scripts, excluded so it cannot defer its own gate. */
  selfExcluded: string[];
  /** Hashed / all-digit names dropped as genuine noise. */
  noiseDropped: string[];
  /** token -> why it was fold-protected ("ancestor-fold" | "dormant-subtree"). */
  foldReasons: Record<string, string>;
  /** One entry per audited page: where every script went. */
  funnel: PageFunnel[];
  /** Did applying `hideSelectors` actually keep the first 1100px intact? */
  foldAssertion: FoldAssertion;
  pagesAudited: string[];
  completedAt: string;
  scriptInventory?: ScriptInventoryBlock;
  warnings?: string[];
  labVitalsByPath?: Record<string, LabVitalsEntry>;
  gateImpact?: GateImpactEntry;
  fieldVitals?: FieldVitalsSummary;
  limits?: string[];
  popupSelectors?: string[];
  auditRunMeta?: AuditRunMeta;
  imageRecommendations?: AuditReportSummary["imageRecommendations"];
  templateBuckets?: AuditReportSummary["templateBuckets"];
  pageRoles?: Record<string, string>;
}

export interface PageFunnel {
  request: number;
  dom: number;
  resourceTiming: number;
  requestOnly: number;
  disagreement: number;
  candidates: number;
  neverDefer: number;
  noise: number;
  selfExcluded: number;
  foldProtected: number;
  coverageRan: number;
  coverageUnknown: number;
  emitted: number;
  settle: SettleReport;
}

export interface FoldAssertion {
  pagesChecked: number;
  /** Selectors that hid an element inside the first 1100px. Must be empty. */
  violations: string[];
  ok: boolean;
}

export function safePathname(rawUrl: string): string {
  try {
    return new URL(rawUrl).pathname || "/";
  } catch {
    return rawUrl;
  }
}

/** The storefront could not be audited because of its password page. The
 * `code` is stored in `StoreConfig.auditError` and mapped to a message in the
 * Step 1 UI (which also reveals the password box). */
export type AuditBlockCode = "PASSWORD_REQUIRED" | "PASSWORD_INCORRECT";

export class AuditBlockedError extends Error {
  code: AuditBlockCode;
  constructor(code: AuditBlockCode) {
    super(
      code === "PASSWORD_REQUIRED"
        ? "The store is password protected and no storefront password is saved."
        : "The saved storefront password did not unlock the store.",
    );
    this.name = "AuditBlockedError";
    this.code = code;
  }
}

export function assertAuditRunActive(signal?: AbortSignal, runDeadlineAt?: number): void {
  if (signal?.aborted) throw new AuditRunCancelledError();
  if (runDeadlineAt != null && Date.now() > runDeadlineAt) throw new AuditRunTimeoutError();
}

export interface CustomUrls {
  /** Extra pages from the "+" button. Validated at save time, but re-checked
   *  here because the stored value could predate a hostname change. */
  extras?: string[];
  plp?: string;
  pdp?: string;
}

export const STORE_KEY = "shopAuditState_v1";
export const P_KEY = "shopAuditP_v1";
export const VIS_KEY = "shopAuditVisible_v1";
export const OFF_KEY = "shopAuditOff_v1";
export type AuditPhase = "discovering" | "auditing" | "building";

export type AuditProgress = {
  done: number; // pages whose audit has finished
  total: number; // total pages to audit
  path?: string; // pathname of the page that just finished (parallel audit)
};

// Audit timing. The old script slept a fixed 30 s per page; now each page is
// measured once it has actually settled. All pages run at the same time, so
// the whole audit takes about as long as the slowest page.
//
// IMPORTANT (measured): `waitForLoadState('networkidle')` is NOT a usable
// "finished" signal here. On a store with analytics beacons it never fires
// inside 30 s, so a 8 s cap just gives up and measures mid-load — on one
// measured store the last script finished at 10 780 ms, past the old 10 500 ms
// cap. We therefore wait on `max(responseEnd)` over script resource entries
// and require it to be stable across consecutive checks. These are safety nets
// against a pathological page, not the exit condition.
export const SETTLE_STABLE_CHECKS = 2; // consecutive identical counts required
/** Minimum time to observe before "stable" can mean "finished".
 *  Stability alone is not enough: a page that is quiet for 1.8s can still have a
 *  lazy chunk arriving at 2.5s, and declaring completion then silently drops it
 *  from the audit. The old capped wait effectively had a ~10.5s floor; this
 *  keeps a real (smaller) one so a quiet lull is never mistaken for the end. */

// Interaction-simulation timing. Runs before the settle block above, so it
// adds to (not replaces) the existing per-page budget.
export const FOLD_HEIGHT_PX = 1100; // "initial viewport" band, measured from document top
export const SCROLL_STEP_PX = 900;
/** Hard floor on scroll steps. The real count is derived from the document
 *  height — the previous fixed 4 steps covered 3600px, which is only 38% of a
 *  measured 9440px home page, so scroll-gated code in the lower two thirds
 *  never ran. */
export const MIN_SCROLL_STEPS = 6;
export const MAX_SCROLL_STEPS = 40; // a pathological page must not stall the audit
export const MAX_INTERACTION_TARGETS = 25; // 25 safe targets existed on a measured page

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
/** Hard cap on merchant-added extra pages. Each one is a full headless page
 *  load per pass, so this bounds the audit's wall time. Reaching it logs a
 *  warning rather than silently truncating. */

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

interface PageAccumulators {
  p: string[];
  vis: string[];
  off: string[];
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

interface SettleReport {
  /** True "all scripts loaded" = max responseEnd over script resources. */
  lastScriptResponseEnd: number;
  preInteractionWaitMs: number;
  postInteractionWaitMs: number;
  /** Scripts that arrived only after the interaction pass. */
  postInteractionDelta: number;
  scrollSteps: number;
  clicks: number;
  hitSafetyNet: boolean;
  domMutationCount?: number;
}

export function emptyAccumulators(): PageAccumulators {
  return {
    p: [],
    vis: [],
    off: [],
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
  /** Token -> how the script tag was loaded on this page (home page drives tiering). */
  loadHintsByToken?: Record<string, import("./audit-candidates").ScriptLoadingHint>;
  /** Still on the storefront password page (none saved, or it was wrong). */
  blocked?: boolean;
  resourceRows?: Array<{
    url: string;
    transferSize?: number;
    encodedBodySize?: number;
    duration?: number;
    pathname: string;
    requestOrder?: number;
    startTime?: number;
    tbtContributionMs?: number;
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
export function appendPreviewParams(
  url: string,
  { password, themeId }: { password?: string; themeId?: string },
): string {
  const u = new URL(url);
  if (password) u.searchParams.set("password", password);
  if (themeId) u.searchParams.set("preview_theme_id", themeId);
  return u.toString();
}

// Scalar page keys only. `extras` is an ARRAY, so it is handled separately
// below rather than being folded into this scalar loop.
const PAGE_LABELS: Array<[Exclude<keyof DiscoveredPages, "extras">, string]> = [
  ["home", "Home page"],
  ["plp", "Collection page"],
  ["pdp", "Product page"],
];

export interface AuditPageInfo {
  label: string;
  path: string;
  done?: boolean; // set as each page finishes in the parallel audit
}

/** Human-readable list of the pages the audit will walk (Home -> PLP -> PDP,
 * in the same order as `runHiddenAudit`). Only the URL *pathname* is kept, so
 * `?password=` / `preview_theme_id=` never reach the DB, API or UI. */
export function describePages(pages: DiscoveredPages): AuditPageInfo[] {
  const out: AuditPageInfo[] = [];
  // Canonical pages first, in a stable order, so the report always leads with
  // home -> collection -> product.
  for (const [key, label] of PAGE_LABELS) {
    const url = pages[key];
    // `extras` is an array, not a string. It is handled below, but the guard
    // keeps this loop safe if PAGE_LABELS is ever widened again.
    if (!url || typeof url !== "string") continue;
    let path = url;
    try {
      path = new URL(url).pathname || "/";
    } catch {
      // keep the raw value if it is not an absolute URL
    }
    out.push({ label, path });
  }
  // Then the merchant-added pages, one chip each. They are labelled by path
  // because their page type is unknown, and they come last so they never
  // displace the canonical pages from the top of the report.
  for (const extra of pages.extras ?? []) {
    let path = extra;
    try {
      path = new URL(extra).pathname || "/";
    } catch {
      // keep the raw value
    }
    out.push({ label: "Extra page", path });
  }
  return out;
}

/** One GraphQL round trip: published collections with their best-selling
 * products (`BEST_SELLING` is only valid on `Collection.products`, not on the
 * root `products` field) plus one published product as a fallback. */
