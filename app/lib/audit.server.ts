import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { buildGatedSinglePageAuditScript } from "./audit-script";
import {
  coverageVerdict,
  mergeSlugVariants,
  pageMatchPatterns,
  urlToCandidates,
  type CoverageEntry,
} from "./audit-candidates";
import { normalizeCustomUrl } from "./page-urls.server";

/** A `Profiler.ScriptCoverage` record: `coverageVerdict` only needs
 *  `functions`, but callers also need the `url` to map the record back to
 *  candidate tokens. */
type ScriptCoverageEntry = CoverageEntry & { url: string };

/**
 * Only real network scripts are meaningful for deferral decisions.
 *
 * Playwright's `stopJSCoverage` already returns nothing but scripts, but CDP's
 * `Profiler.takePreciseCoverage` additionally reports `extension://`,
 * `devtools://`, `blob:` and `data:` documents. Feeding those to
 * `urlToCandidates` would mint garbage slugs for them and pollute the emitted
 * lists, so they are dropped before classification.
 */
function isRealScriptUrl(url: string): boolean {
  return /^https?:/i.test(url) && /\.js(\?|#|$)/i.test(url);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export interface DiscoveredPages {
  home: string;
  plp?: string;
  pdp?: string;
}

export interface HiddenAuditResult {
  /** Union of every page's deferrable scripts. Kept as the union on purpose:
   *  `StoreConfig.auditDeferArray` -> `rebuildPerformanceScript` -> obfuscate
   *  -> app proxy is the existing consumer path and must not change shape. */
  deferArray: string[];
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

function safePathname(rawUrl: string): string {
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

interface CustomUrls {
  plp?: string;
  pdp?: string;
}

const STORE_KEY = "shopAuditState_v1";
const P_KEY = "shopAuditP_v1";
const VIS_KEY = "shopAuditVisible_v1";
const OFF_KEY = "shopAuditOff_v1";

function chromiumExecutablePath(): string | undefined {
  const envPath = process.env.CHROMIUM_PATH;
  return envPath || undefined;
}

// One Chromium is kept warm and shared by page discovery + the audit, instead
// of a ~1 s launch per use. Each audited page gets its own browser *context*
// (isolated localStorage/cookies), so the parallel pages never interfere.
// The browser closes itself after a period of no use to free memory.
const BROWSER_IDLE_CLOSE_MS = 2 * 60 * 1000;
let browserPromise: Promise<Browser> | null = null;
let browserUsers = 0;
let browserIdleTimer: ReturnType<typeof setTimeout> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    const existing = await browserPromise.catch(() => null);
    if (existing?.isConnected()) return existing;
    browserPromise = null;
  }
  const launching = chromium.launch({
    headless: true,
    executablePath: chromiumExecutablePath(),
  });
  browserPromise = launching;
  launching
    .then((b) =>
      b.on("disconnected", () => {
        if (browserPromise === launching) browserPromise = null;
      }),
    )
    .catch(() => {
      if (browserPromise === launching) browserPromise = null;
    });
  return launching;
}

export async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  browserUsers++;
  try {
    return await fn(await getBrowser());
  } finally {
    browserUsers--;
    if (browserUsers === 0) {
      browserIdleTimer = setTimeout(() => {
        const closing = browserPromise;
        browserPromise = null;
        closing?.then((b) => b.close()).catch(() => {});
      }, BROWSER_IDLE_CLOSE_MS);
      browserIdleTimer.unref?.();
    }
  }
}

async function graphqlJson(admin: AdminClient, query: string) {
  const res = await admin.graphql(query);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e: { message?: string }) => e.message).join("; "),
    );
  }
  return json.data;
}

/** Appends the query params the hidden audit's headless browser needs to see
 * the storefront the merchant actually chose:
 *  - `password` — Shopify's documented programmatic storefront-password bypass
 *    (the store owner's own password, saved in Step 1), and
 *  - `preview_theme_id` — renders a specific (non-live) theme, so the audit
 *    scans the theme the app extension was installed in.
 * Either, both or neither may be given; with neither the URL is returned as is. */
export function appendPreviewParams(
  url: string,
  { password, themeId }: { password?: string; themeId?: string },
): string {
  const u = new URL(url);
  if (password) u.searchParams.set("password", password);
  if (themeId) u.searchParams.set("preview_theme_id", themeId);
  return u.toString();
}

const PAGE_LABELS: Array<[keyof DiscoveredPages, string]> = [
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
  for (const [key, label] of PAGE_LABELS) {
    const url = pages[key];
    if (!url) continue;
    let path = url;
    try {
      path = new URL(url).pathname || "/";
    } catch {
      // keep the raw value if it is not an absolute URL
    }
    out.push({ label, path });
  }
  return out;
}

interface DiscoveryProduct {
  handle: string;
  onlineStoreUrl?: string | null;
}
interface DiscoveryData {
  collections?: {
    nodes?: Array<{
      handle: string;
      products?: { nodes?: DiscoveryProduct[] };
    }>;
  };
  products?: { nodes?: DiscoveryProduct[] };
}

/** Picks the PLP / PDP from the discovery query result (pure, unit-testable).
 *  - PLP: the first published collection that has a product on the storefront;
 *    else `/collections/all` (always exists) when the store has any published
 *    product; else none.
 *  - PDP: that collection's best-selling product that is actually on the
 *    storefront (`onlineStoreUrl` set); else the first published product. */
export function pickPagesFromDiscovery(
  data: DiscoveryData,
  shopDomain: string,
): { plp?: string; pdp?: string } {
  const onStorefront = (p: DiscoveryProduct) => Boolean(p.onlineStoreUrl);
  const anyProduct = data.products?.nodes?.[0];
  const collection = (data.collections?.nodes ?? []).find((c) =>
    (c.products?.nodes ?? []).some(onStorefront),
  );

  let plpPath: string | undefined;
  let pdpHandle: string | undefined;
  if (collection) {
    plpPath = `/collections/${collection.handle}`;
    pdpHandle = (collection.products?.nodes ?? []).find(onStorefront)?.handle;
  }
  if (!plpPath && anyProduct) plpPath = "/collections/all";
  if (!pdpHandle && anyProduct?.handle) pdpHandle = anyProduct.handle;

  return {
    plp: plpPath ? `https://${shopDomain}${plpPath}` : undefined,
    pdp: pdpHandle ? `https://${shopDomain}/products/${pdpHandle}` : undefined,
  };
}

/** One GraphQL round trip: published collections with their best-selling
 * products (`BEST_SELLING` is only valid on `Collection.products`, not on the
 * root `products` field) plus one published product as a fallback. */
async function discoverViaGraphql(
  admin: AdminClient,
  shopDomain: string,
): Promise<{ plp?: string; pdp?: string }> {
  const data = await graphqlJson(
    admin,
    `#graphql
    query PageDiscovery {
      collections(first: 20, query: "published_status:published") {
        nodes {
          handle
          products(first: 3, sortKey: BEST_SELLING) {
            nodes { handle onlineStoreUrl }
          }
        }
      }
      products(first: 1, query: "status:active published_status:published") {
        nodes { handle onlineStoreUrl }
      }
    }`,
  );
  return pickPagesFromDiscovery(data as DiscoveryData, shopDomain);
}

const HOME_FETCH_TIMEOUT_MS = 8000;

/** True when a fetched page is Shopify's storefront password page. */
export function isPasswordPageHtml(finalUrl: string, html: string): boolean {
  try {
    if (/^\/password\/?$/.test(new URL(finalUrl).pathname)) return true;
  } catch {
    // ignore an unparsable URL and fall through to the markup check
  }
  return /<form[^>]+action=["'][^"']*\/password/i.test(html);
}

/** If `page` is showing the storefront password page, submit `password` and
 * wait for the storefront to load. Returns true when the page was locked.
 * Shared by page discovery and the audit itself. */
/** True when `page` is showing Shopify's storefront password page: the
 * `/password` route, or its form (`action="/password"` + `name="password"`). */
export async function isPasswordPage(page: Page): Promise<boolean> {
  return page
    .evaluate(() => {
      if (/(^|\/)password\/?$/.test(location.pathname)) return true;
      const input = document.querySelector<HTMLInputElement>(
        'input[name="password"], input[type="password"]',
      );
      const form = input?.closest("form");
      if (!form) return false;
      const action = form.getAttribute("action") || "";
      try {
        return /(^|\/)password\/?$/.test(
          new URL(action, location.href).pathname,
        );
      } catch {
        return /(^|\/)password\/?$/i.test(action);
      }
    })
    .catch(() => false);
}

export async function unlockPasswordPage(
  page: Page,
  password: string,
): Promise<boolean> {
  if (!(await isPasswordPage(page))) return false;

  console.log("[audit] Password page detected — submitting bypass form.");
  const navigation = page
    .waitForNavigation({ waitUntil: "load", timeout: 30000 })
    .catch(() => undefined);
  const submitted = await page
    .evaluate((pw) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[name="password"], input[type="password"]',
      );
      const form = (input?.closest("form") ??
        document.querySelector<HTMLFormElement>('form[action*="password"], form')) as
        | HTMLFormElement
        | null;
      if (!input || !form) return false;
      input.value = pw;
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        form.submit();
      }
      return true;
    }, password)
    .catch(() => false);
  if (!submitted) return false;
  await navigation;
  return true;
}

/** After unlocking, Shopify redirects to the store root, which can drop the
 * requested page and `?preview_theme_id=`. Go back to the requested URL. */
export async function returnToRequestedUrl(
  page: Page,
  requestedUrl: string,
  timeout: number,
): Promise<void> {
  try {
    const want = new URL(requestedUrl);
    const now = new URL(page.url());
    const sameTheme =
      (want.searchParams.get("preview_theme_id") ?? "") ===
      (now.searchParams.get("preview_theme_id") ?? "");
    if (want.pathname !== now.pathname || !sameTheme) {
      await page.goto(requestedUrl, { waitUntil: "load", timeout });
    }
  } catch {
    // best-effort; the caller measures whatever loaded
  }
}

/** Fallback 1 (no browser): read collection/product links from the homepage
 * HTML with a plain HTTP request, ~10x faster than launching Chromium. */
async function discoverViaHtml(
  home: string,
): Promise<{ plp?: string; pdp?: string; passwordPage?: boolean }> {
  try {
    const res = await fetch(home, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; PagePulseAudit/1.0)" },
      signal: AbortSignal.timeout(HOME_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const html = await res.text();
    // A password-protected store answers with the password page (no product or
    // collection links to find). Report it so the caller can stop early (no
    // saved password) or let the browser fallback unlock it (password saved).
    if (isPasswordPageHtml(res.url, html)) return { passwordPage: true };
    const find = (segment: string) => {
      const m = html.match(
        new RegExp(`href=["']([^"'#?]*/${segment}/[a-z0-9_-][^"'#?]*)`, "i"),
      );
      if (!m) return undefined;
      try {
        return new URL(m[1], home).toString();
      } catch {
        return undefined;
      }
    };
    return { plp: find("collections"), pdp: find("products") };
  } catch {
    return {};
  }
}

/** Fallback 2 (last resort): render the homepage in the shared browser. */
async function discoverViaBrowser(
  home: string,
  need: { plp: boolean; pdp: boolean },
  password?: string,
): Promise<{ plp?: string; pdp?: string }> {
  try {
    return await withBrowser(async (browser) => {
      const context = await browser.newContext();
      try {
        const page = await context.newPage();
        await page.goto(home, { waitUntil: "domcontentloaded", timeout: 45000 });
        // Password-protected store: enter the saved password, then make sure we
        // are back on the requested (theme-preview) home page.
        if (password && (await unlockPasswordPage(page, password))) {
          await returnToRequestedUrl(page, home, 45000);
        }
        const firstHref = async (selectors: string[]) => {
          for (const selector of selectors) {
            const href = await page
              .locator(selector)
              .first()
              .getAttribute("href", { timeout: 2000 })
              .then((h) => (h ? new URL(h, home).toString() : undefined))
              .catch(() => undefined);
            if (href) return href;
          }
          return undefined;
        };
        return {
          plp: need.plp
            ? await firstHref([
                'a[href*="/collections/"]',
                'a[href*="/shop"]',
                'a[href*="/catalog"]',
                'a[href*="/collection"]',
              ])
            : undefined,
          pdp: need.pdp
            ? await firstHref(['a[href*="/products/"]', 'a[href*="/product/"]'])
            : undefined,
        };
      } finally {
        await context.close().catch(() => {});
      }
    });
  } catch (err) {
    console.warn(
      "[audit] Homepage browser fallback failed:",
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}

/** Discover Home / PLP / PDP URLs for a store, fastest source first:
 * merchant-provided URLs, then one Admin GraphQL call, then the homepage HTML
 * over plain HTTP, and only then a browser render.
 *
 * When `password` is provided (the store owner's own storefront password,
 * saved in Step 1 for a password-protected store), each URL is rewritten
 * with a `?password=` param, and the browser steps also submit the password
 * form when they land on the password page, so the hidden audit reaches the
 * real storefront. When `themeId` is provided (numeric id of a non-live theme the
 * merchant selected) each URL also gets `?preview_theme_id=` so that theme is
 * the one that is audited. */
export async function discoverPages(
  admin: AdminClient,
  shopDomain: string,
  password?: string,
  themeId?: string,
  customUrls?: CustomUrls,
): Promise<DiscoveredPages> {
  const home = `https://${shopDomain}/`;
  const params = { password, themeId };
  const shopHost = shopDomain.toLowerCase();

  // Merchant-typed URLs are validated again here so a bad saved value can never
  // fail the audit, and the store password is never sent to another host.
  const customFor = (kind: "plp" | "pdp", raw?: string): string | undefined => {
    const r = normalizeCustomUrl(raw, shopDomain, kind);
    if (!r.ok) {
      console.warn(`[audit] Ignoring invalid custom ${kind} URL: ${r.error}`);
      return undefined;
    }
    return r.url;
  };
  // Links scraped from a page must stay on the store's own host too.
  const ownHost = (u?: string): string | undefined => {
    if (!u) return undefined;
    try {
      return new URL(u).hostname.toLowerCase() === shopHost ? u : undefined;
    } catch {
      return undefined;
    }
  };

  let plp = customFor("plp", customUrls?.plp);
  let pdp = customFor("pdp", customUrls?.pdp);
  const source = { plp: plp ? "custom" : "none", pdp: pdp ? "custom" : "none" };
  const adopt = (found: { plp?: string; pdp?: string }, via: string) => {
    if (!plp && ownHost(found.plp)) {
      plp = found.plp;
      source.plp = via;
    }
    if (!pdp && ownHost(found.pdp)) {
      pdp = found.pdp;
      source.pdp = via;
    }
  };

  if (!plp || !pdp) {
    try {
      adopt(await discoverViaGraphql(admin, shopDomain), "graphql");
    } catch (err) {
      console.error(
        "[audit] GraphQL page discovery failed, falling back to HTML:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (!plp || !pdp) {
    const htmlFound = await discoverViaHtml(appendPreviewParams(home, params));
    // Password page and nothing to unlock it with: no page can be audited.
    if (htmlFound.passwordPage && !password) {
      throw new AuditBlockedError("PASSWORD_REQUIRED");
    }
    adopt(htmlFound, "html");
  }

  if (!plp || !pdp) {
    adopt(
      await discoverViaBrowser(
        appendPreviewParams(home, params),
        { plp: !plp, pdp: !pdp },
        password,
      ),
      "browser",
    );
  }

  console.log(
    `[audit] Page sources for ${shopDomain}: plp=${source.plp}, pdp=${source.pdp}`,
  );

  // Graceful degradation: continue with whatever pages were discovered (minimum home)
  if (!plp && !pdp) {
    console.warn("[audit] Only home page discovered, auditing home only");
  }

  if (password || themeId) {
    return {
      home: appendPreviewParams(home, params),
      plp: plp ? appendPreviewParams(plp, params) : undefined,
      pdp: pdp ? appendPreviewParams(pdp, params) : undefined,
    };
  }

  return { home, plp, pdp };
}

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
const PAGE_LOAD_TIMEOUT_MS = 45000;
const NETWORK_IDLE_CAP_MS = 8000; // upper bound per quiet-period probe
const SETTLE_STABLE_CHECKS = 2; // consecutive identical counts required
const SETTLE_PROBE_GAP_MS = 900; // quiet gap between probes
/** Minimum time to observe before "stable" can mean "finished".
 *  Stability alone is not enough: a page that is quiet for 1.8s can still have a
 *  lazy chunk arriving at 2.5s, and declaring completion then silently drops it
 *  from the audit. The old capped wait effectively had a ~10.5s floor; this
 *  keeps a real (smaller) one so a quiet lull is never mistaken for the end. */
const SETTLE_MIN_MS = 5000;
const SETTLE_SAFETY_NET_MS = 40000; // never measure later than this
const MEASURE_TIMEOUT_MS = 15000; // max time for the in-page measurement

// Interaction-simulation timing. Runs before the settle block above, so it
// adds to (not replaces) the existing per-page budget.
const FOLD_HEIGHT_PX = 1100; // "initial viewport" band, measured from document top
const SCROLL_STEP_PX = 900;
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
}

function emptyAccumulators(): PageAccumulators {
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

interface MeasuredPage {
  context: BrowserContext;
  page: Page;
  acc: PageAccumulators;
  /** Still on the storefront password page (none saved, or it was wrong). */
  blocked?: boolean;
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
async function collapseToParentSelectors(
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
async function verifyFoldSurvives(
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

/** Loads one page in its own isolated browser context and runs the audit
 * script on it. The page is left open (caller closes the context) so the
 * merged selectors can be re-checked against it afterwards. */
async function measurePage(
  browser: Browser,
  url: string,
  password?: string,
): Promise<MeasuredPage> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();

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
    const fold = await captureInitialFold(page);

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
    const interaction = await simulateInteractions(page);
    const revealedByInteraction = interaction.revealed;

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
        ([P, VIS, OFF]) => {
          const load = (k: string) => {
            try {
              return JSON.parse(localStorage.getItem(k) || "[]");
            } catch {
              return [];
            }
          };
          return { p: load(P), vis: load(VIS), off: load(OFF) };
        },
        [P_KEY, VIS_KEY, OFF_KEY],
      )
      .catch(() => ({ p: [] as string[], vis: [] as string[], off: [] as string[] }));

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

    return {
      context,
      page,
      acc: {
        p: [...mergedKept],
        vis: [...new Set([...read.vis, ...fold.selectors, ...revealedByInteraction])],
        off: read.off,
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
async function selectorsVisibleOnPage(
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
async function selectorsOverlapFoldOnPage(
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

/** Runs the audit script against all discovered pages at the same time (one
 * isolated browser context per page) and merges the results:
 *  - defer list = union of every page's third-party script fragments,
 *  - hide selectors = selectors off-screen somewhere and never visible on any
 *    page (same rule the script itself applies across pages). */
export async function runHiddenAudit({
  pages,
  password,
  onProgress,
}: {
  pages: DiscoveredPages;
  // Store owner's storefront password (Step 1). `pages` URLs already carry
  // the `?password=` bypass query param when set — this is only used as a
  // fallback to submit Shopify's password form if the query param alone
  // doesn't let the store through.
  password?: string;
  onProgress?: (progress: AuditProgress) => void | Promise<void>;
}): Promise<HiddenAuditResult> {
  const urls = [pages.home, pages.plp, pages.pdp].filter(
    (u): u is string => Boolean(u),
  );

  let done = 0;
  await onProgress?.({ done, total: urls.length });

  return withBrowser(async (browser) => {
    const measured: MeasuredPage[] = [];
    try {
      // allSettled: one page failing to open must not abandon the others'
      // contexts (they are all closed in `finally`).
      const settled = await Promise.allSettled(
        urls.map(async (url) => {
          const m = await measurePage(browser, url, password);
          measured.push(m);
          done++;
          let path: string | undefined;
          try {
            path = new URL(url).pathname || "/";
          } catch {
            path = url;
          }
          try {
            await onProgress?.({ done, total: urls.length, path });
          } catch {
            // progress is best-effort
          }
        }),
      );
      if (measured.some((m) => m.blocked)) {
        throw new AuditBlockedError(
          password ? "PASSWORD_INCORRECT" : "PASSWORD_REQUIRED",
        );
      }
      if (measured.length === 0) {
        const failure = settled.find((r) => r.status === "rejected");
        throw failure && failure.status === "rejected"
          ? failure.reason
          : new Error("No pages could be audited.");
      }

      const pSet = new Set<string>();
      const visSet = new Set<string>();
      const offSet = new Set<string>();
      const foldRequiredScripts = new Set<string>();
      const foldReasons: Record<string, string> = {};
      const coverageRan = new Set<string>();
      const coverageUnknown = new Set<string>();
      const neverDefer = new Set<string>();
      const noise = new Set<string>();
      const selfScripts = new Set<string>();
      const funnel: PageFunnel[] = [];
      for (const { acc } of measured) {
        acc.p.forEach((x) => pSet.add(x));
        acc.vis.forEach((x) => visSet.add(x));
        acc.off.forEach((x) => offSet.add(x));
        acc.foldScripts.forEach((x) => foldRequiredScripts.add(x));
        Object.entries(acc.foldReasons).forEach(([k, v]) => {
          if (!foldReasons[k]) foldReasons[k] = v;
        });
        acc.coverageRan.forEach((x) => coverageRan.add(x));
        acc.coverageUnknown.forEach((x) => coverageUnknown.add(x));
        acc.neverDefer.forEach((x) => neverDefer.add(x));
        acc.noise.forEach((x) => noise.add(x));
        acc.selfScripts.forEach((x) => selfScripts.add(x));
        funnel.push({
          request: acc.sources.request,
          dom: acc.sources.dom,
          resourceTiming: acc.sources.resourceTiming,
          requestOnly: acc.sources.requestOnly,
          disagreement: acc.sources.disagreement,
          candidates: acc.p.length,
          neverDefer: acc.neverDefer.length,
          noise: acc.noise.length,
          selfExcluded: acc.selfScripts.length,
          foldProtected: acc.foldScripts.length,
          coverageRan: acc.coverageRan.length,
          coverageUnknown: acc.coverageUnknown.length,
          emitted: acc.p.filter(
            (x) =>
              !acc.foldScripts.includes(x) &&
              !acc.coverageRan.includes(x) &&
              !acc.coverageUnknown.includes(x),
          ).length,
          settle: acc.settle,
        });
      }

      // The script's own cross-page check (an off-screen selector is not
      // hidden if it is a visible section somewhere) needs every page's DOM;
      // pages were audited in isolation, so redo it here across all of them.
      const offList = [...offSet];
      const visibleHits = await Promise.all(
        measured.map(({ page }) => selectorsVisibleOnPage(page, offList)),
      );
      visibleHits.forEach((hits) => hits.forEach((x) => visSet.add(x)));

      // Same cross-page re-check, but for the 1100px fold band instead of
      // plain viewport visibility — see `selectorsOverlapFoldOnPage`.
      const foldHits = await Promise.all(
        measured.map(({ page }) => selectorsOverlapFoldOnPage(page, offList)),
      );
      foldHits.forEach((hits) => hits.forEach((x) => visSet.add(x)));

      // A selector is only ever hidden if nothing it matches sits in the first
      // 1100px on ANY audited page — including an element that only appears
      // later or after interaction. This is checked against every page's live
      // DOM, so a class shared between the fold and the rest of the page is
      // never hidden at all (safe, though it yields nothing).
      const crossPageFoldOnly = await Promise.all(
        measured.map(({ page }) => selectorsOverlapFoldOnPage(page, offList)),
      );
      const foldProtectedSelectors = new Set<string>();
      crossPageFoldOnly.forEach((hits) => hits.forEach((x) => foldProtectedSelectors.add(x)));

      const hideCandidates = offList.filter(
        (x) => !visSet.has(x) && !foldProtectedSelectors.has(x),
      );

      // Collapse to maximal below-fold parents. Hiding 127 per-element
      // selectors is both a large inline stylesheet and fragile; collapsing to
      // the handful of top-most fully-below-fold subtrees is ~93% smaller on a
      // measured page and structurally safer. Every candidate is still checked
      // against the cross-page fold veto above, so collapsing cannot widen what
      // gets hidden beyond what was already proven safe.
      const collapsedSelectors = await Promise.all(
        measured.map(({ page }) => collapseToParentSelectors(page, hideCandidates)),
      );
      const selectorSet = new Set<string>();
      for (const list of collapsedSelectors) list.forEach((s) => selectorSet.add(s));
      // A collapsed parent may reintroduce a selector the veto rejected; drop it.
      for (const s of selectorSet) {
        if (foldProtectedSelectors.has(s) || visSet.has(s)) selectorSet.delete(s);
      }
      const hideSelectors = [...selectorSet].sort();

      // Per-page hide lists. The consumer resolves its page at runtime from
      // location.pathname, so each audited page contributes its own collapsed
      // selectors plus the match patterns that generalise them to sibling pages
      // (a store serves thousands of PDPs but the audit only ever sees three
      // URLs). `hideSelectors` above stays the union so the existing consumer
      // path is unchanged.
      const hideSelectorsByPage: Record<string, string[]> = {};
      const pagePatterns: Record<string, string[]> = {};
      measured.forEach((m, i) => {
        const path = safePathname(urls[i]);
        const local = new Set<string>();
        for (const list of collapsedSelectors[i]) {
          if (foldProtectedSelectors.has(list) || visSet.has(list)) continue;
          local.add(list);
        }
        hideSelectorsByPage[path] = [...local].sort();
        pagePatterns[path] = pageMatchPatterns(path);
      });

      const emittedRaw = [...pSet].filter(
        (x) =>
          !foldRequiredScripts.has(x) &&
          !coverageRan.has(x) &&
          !coverageUnknown.has(x) &&
          !selfScripts.has(x) &&
          !neverDefer.has(x),
      );

      // Per-page breakdown. `deferArray` below stays the union so the existing
      // consumer path (StoreConfig -> rebuildPerformanceScript -> obfuscate ->
      // proxy) is completely unchanged; the per-page view and the slug view are
      // additive and ride inside the same result object.
      const deferArrayByPage: Record<string, string[]> = {};
      measured.forEach((m, i) => {
        const acc = m.acc;
        deferArrayByPage[safePathname(urls[i])] = acc.p
          .filter(
            (x) =>
              !acc.foldScripts.includes(x) &&
              !acc.coverageRan.includes(x) &&
              !acc.coverageUnknown.includes(x) &&
              !acc.selfScripts.includes(x) &&
              !acc.neverDefer.includes(x),
          )
          .sort();
      });

      // Fold-survival assertion. The whole premise is that the first 1100px
      // still looks right with the gate active, and nothing used to check it —
      // which is how an empty `deferArray` shipped unnoticed. This re-applies
      // the emitted hide CSS to each page and asks the browser whether any
      // fold-overlapping element disappeared.
      const foldAssertion = await verifyFoldSurvives(measured, hideSelectors);

      // Base + delta. The storefront bundle ships the intersection once and each
      // page only its extras, which keeps a render-blocking script small: full
      // per-page lists measured +65% bundle size for the same behaviour.
      const pageKeys = Object.keys(deferArrayByPage);
      let baseScripts: Set<string> = new Set<string>();
      if (pageKeys.length > 0) {
        baseScripts = new Set(deferArrayByPage[pageKeys[0]]);
        for (const k of pageKeys.slice(1)) {
          const onPage = new Set(deferArrayByPage[k]);
          baseScripts = new Set([...baseScripts].filter((x) => onPage.has(x)));
        }
      }
      const deferArrayAddByPage: Record<string, string[]> = {};
      for (const k of pageKeys) {
        deferArrayAddByPage[k] = deferArrayByPage[k].filter((x) => !baseScripts.has(x));
      }

      // The funnel is logged here rather than in audit-runner.server.ts so the
      // change stays inside the audit module. A `defer=[]` from "everything is
      // fold-protected" must be distinguishable from `defer=[]` caused by a
      // cleared array — that ambiguity is what hid the coverage bug.
      console.log(
        `[audit] funnel ${JSON.stringify(
          {
            foldAssertion: foldAssertion.ok ? "pass" : `FAIL:${foldAssertion.violations.length}`,
            pages: funnel.map((f) => ({
              request: f.request,
              dom: f.dom,
              rt: f.resourceTiming,
              requestOnly: f.requestOnly,
              disagreement: f.disagreement,
              kept: f.candidates,
              neverDefer: f.neverDefer,
              noise: f.noise,
              self: f.selfExcluded,
              fold: f.foldProtected,
              covRan: f.coverageRan,
              covUnknown: f.coverageUnknown,
              emitted: f.emitted,
              lastScriptMs: f.settle.lastScriptResponseEnd,
              postInteractionDelta: f.settle.postInteractionDelta,
              scrollSteps: f.settle.scrollSteps,
              clicks: f.settle.clicks,
              safetyNet: f.settle.hitSafetyNet,
            })),
            emittedTotal: emittedRaw.length,
            hideSelectors: hideSelectors.length,
          },
          null,
          0,
        )}`,
      );

      // Build hashes change between theme versions, not between the pages of a
      // single run, so this is normally a no-op here. It exists so a report
      // emitted as `app.9pOKhaB_.js` stops silently matching after the merchant
      // redeploys: divergent variants of one script are unified to their
      // longest common prefix (`store-BTEJUR`/`store-BTEJKB` -> `store-BTE`).
      const mergedDefer = mergeSlugVariants(emittedRaw).sort();

      return {
        deferArray: mergedDefer,
        deferArrayByPage: Object.fromEntries(
          Object.entries(deferArrayByPage).map(([k, v]) => [k, mergeSlugVariants(v).sort()]),
        ),
        /** The un-merged tokens, kept so the funnel can be reconciled. */
        deferArrayUnmerged: emittedRaw.sort(),
        /** Scripts every audited page loads — shipped once in the bundle. */
        deferArrayBase: [...baseScripts].sort(),
        /** Per-page extras on top of `deferArrayBase`. */
        deferArrayAddByPage,
        hideSelectors,
        hideSelectorsByPage,
        pagePatterns,
        neverDefer: [...neverDefer].sort(),
        selfExcluded: [...selfScripts].sort(),
        noiseDropped: [...noise].sort(),
        foldReasons,
        funnel,
        foldAssertion,
        // Paths only: the audited URLs carry `?password=` / `preview_theme_id=`,
        // and this list is persisted in AuditLog.
        pagesAudited: urls.map((u) => {
          try {
            return new URL(u).pathname || "/";
          } catch {
            return u;
          }
        }),
        completedAt: new Date().toISOString(),
      };
    } finally {
      await Promise.all(measured.map((m) => m.context.close().catch(() => {})));
    }
  });
}
