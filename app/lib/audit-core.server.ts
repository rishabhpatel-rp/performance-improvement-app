import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import {
  mergeSlugVariants,
  pageMatchPatterns,
  urlToCandidates,
  type CoverageEntry,
} from "./audit-candidates";
import { normalizeCustomUrl } from "./page-urls.server";
import type {
  AuditRunMeta,
  FieldVitalsSummary,
  GateImpactEntry,
  LabVitalsEntry,
} from "./audit-report-types";
import { COLLECT_LAB_VITALS_JS } from "./audit-metrics.server";
import { applyMobileLabThrottling } from "./audit-metrics.server";
import type { AuditPageRole } from "./audit-template-buckets";

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
export function isRealScriptUrl(url: string): boolean {
  return /^https?:/i.test(url) && /\.js(\?|#|$)/i.test(url);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

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
  /** Includes `popupSelectors`: every popup is hidden until first interaction. */
  hideSelectors: string[];
  /** Per-page hide lists, keyed by the audited page's pathname. Includes
   *  `popupSelectors` on every page. */
  hideSelectorsByPage: Record<string, string[]>;
  /** Popups found while auditing (open at load, opened later, or opened and
   *  closed again). Already merged into `hideSelectors`; listed separately so
   *  they can be seen and reported on their own. */
  popupSelectors: string[];
  /** The popups each audited page produced, before they were shared sitewide. */
  popupSelectorsByPage: Record<string, string[]>;
  /** Match patterns per audited page, most specific first. The consumer walks
   *  these in order against `location.pathname` so one bundle can serve every
   *  PDP/PLP on the store, not just the three URLs the audit saw. */
  pagePatterns: Record<string, string[]>;
  /** Audited pathname -> template role (home / collection / product / extra). */
  pageRoles?: Record<string, AuditPageRole>;
  /** Defer lists split for storefront variants (see audit-template-buckets.ts). */
  templateBuckets?: {
    defer: import("./audit-template-buckets").TemplateDeferBuckets;
    hide: import("./audit-template-buckets").TemplateDeferBuckets;
  };
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
  warnings?: string[];
  limits?: string[];
  scriptInventory?: import("./audit-report-types").ScriptInventoryBlock;
  labVitalsByPath?: Record<string, LabVitalsEntry>;
  gateImpact?: GateImpactEntry;
  auditRunMeta?: AuditRunMeta;
  fieldVitals?: FieldVitalsSummary;
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

export interface SettleReport {
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

export function pageRolesFromDiscovery(
  pages: DiscoveredPages,
): Record<string, AuditPageRole> {
  const roles: Record<string, AuditPageRole> = {};
  roles[safePathname(pages.home)] = "home";
  if (pages.plp) roles[safePathname(pages.plp)] = "collection";
  if (pages.pdp) roles[safePathname(pages.pdp)] = "product";
  for (const u of pages.extras ?? []) roles[safePathname(u)] = "extra";
  return roles;
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
  /** Extra pages from the "+" button. Validated at save time, but re-checked
   *  here because the stored value could predate a hostname change. */
  extras?: string[];
  plp?: string;
  pdp?: string;
}

/** Hard cap on merchant-added extra pages (full headless load each). */
const MAX_EXTRA_PAGES = 8;

const STORE_KEY = "shopAuditState_v1";
const P_KEY = "shopAuditP_v1";
const VIS_KEY = "shopAuditVisible_v1";
const OFF_KEY = "shopAuditOff_v1";
/** Popup selectors recorded by the audit script's popup block (see POPUP_AUDIT_JS). */
const POPUP_KEY = "shopAuditPopups_v1";
/** Extra time a page is watched for popups that open on a timer / exit intent,
 *  after the interaction pass and before the audit script measures. */
const POPUP_WATCH_MS = 3500;

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
      headers: { "user-agent": PAGEPULSE_AUDIT_UA },
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

    // Extra pages go through the same validation, de-duplicated and capped: a
    // merchant can add many rows, and each one is a full headless page load, so
    // an unbounded list would turn a 2-minute audit into an hour.
    const extras: string[] = [];
    for (const raw of customUrls?.extras ?? []) {
      const r = normalizeCustomUrl(raw, shopDomain, "page");
      if (!r.ok) {
        console.warn(`[audit] Ignoring invalid extra page URL: ${r.error}`);
        continue;
      }
      if (!r.url) continue;
      // The homepage and the PLP/PDP are already measured; measuring them twice
      // would double-count and waste a page load.
      if (r.url === `https://${shopHost}/` || r.url === plp || r.url === pdp) continue;
      if (!extras.includes(r.url)) extras.push(r.url);
      if (extras.length >= MAX_EXTRA_PAGES) {
        console.warn(
          `[audit] Extra page limit (${MAX_EXTRA_PAGES}) reached; the rest were ignored.`,
        );
        break;
      }
    }

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
      extras: extras.map((u) => appendPreviewParams(u, params)),
    };
  }

  return { home, plp, pdp, extras };
}

export type AuditPhase = "discovering" | "auditing" | "building";

export type AuditProgress = {
  done: number;
  total: number;
  path?: string;
  pass?: number;
  waitMs?: number;
  scripts?: number;
  emitted?: number;
  foldOk?: boolean;
};

export const PAGEPULSE_AUDIT_UA =
  "Mozilla/5.0 (compatible; PagePulseAudit/2.0; +https://pagepulse.app)";

