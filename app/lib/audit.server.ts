import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { buildGatedSinglePageAuditScript } from "./audit-script";
import { normalizeCustomUrl } from "./page-urls.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export interface DiscoveredPages {
  home: string;
  plp?: string;
  pdp?: string;
}

export interface HiddenAuditResult {
  deferArray: string[];
  hideSelectors: string[];
  pagesAudited: string[];
  completedAt: string;
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

async function withBrowser<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
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
export async function unlockPasswordPage(
  page: Page,
  password: string,
): Promise<boolean> {
  const isPasswordPage = await page
    .evaluate(() => {
      const form = document.querySelector(
        'form[action="/password"], form[action*="password"]',
      );
      const input = document.querySelector('input[name="password"]');
      return Boolean(form || input);
    })
    .catch(() => false);
  if (!isPasswordPage) return false;

  console.log("[audit] Password page detected — submitting bypass form.");
  // Start waiting for the navigation BEFORE submitting so it cannot be missed.
  await Promise.all([
    page
      .waitForNavigation({ waitUntil: "load", timeout: 30000 })
      .catch(() => {}),
    page
      .evaluate((pw) => {
        const input = document.querySelector(
          'input[name="password"]',
        ) as HTMLInputElement | null;
        const form = document.querySelector(
          'form[action="/password"], form',
        ) as HTMLFormElement | null;
        if (input && form) {
          input.value = pw;
          form.submit();
        }
      }, password)
      .catch(() => {}),
  ]);
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
): Promise<{ plp?: string; pdp?: string }> {
  try {
    const res = await fetch(home, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; PagePulseAudit/1.0)" },
      signal: AbortSignal.timeout(HOME_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const html = await res.text();
    // A password-protected store answers with the password page (no product or
    // collection links to find) — let the browser fallback unlock it instead.
    if (isPasswordPageHtml(res.url, html)) return {};
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
    adopt(await discoverViaHtml(appendPreviewParams(home, params)), "html");
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
};

// Audit timing. The old script slept a fixed 30 s per page; now each page is
// measured once it has actually settled. All pages run at the same time, so
// the whole audit takes about as long as the slowest page.
const PAGE_LOAD_TIMEOUT_MS = 45000;
const NETWORK_IDLE_CAP_MS = 8000; // max wait for the network to go quiet
const SETTLE_MS = 2500; // late timer-loaded scripts after the first idle
const MEASURE_TIMEOUT_MS = 15000; // max time for the in-page measurement

interface PageAccumulators {
  p: string[];
  vis: string[];
  off: string[];
}

interface MeasuredPage {
  context: BrowserContext;
  page: Page;
  acc: PageAccumulators;
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
        return { context, page, acc: { p: [], vis: [], off: [] } };
      }
    }

    // Let the page settle: network quiet, a mouse move to wake pointer-gated
    // scripts, a short pause for timer-loaded ones, then quiet again.
    await page
      .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_CAP_MS })
      .catch(() => {});
    await page.mouse.move(1, 1).catch(() => {});
    await page.mouse.move(3, 3).catch(() => {});
    await page.waitForTimeout(SETTLE_MS);
    await page
      .waitForLoadState("networkidle", { timeout: NETWORK_IDLE_CAP_MS })
      .catch(() => {});
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
      .catch(() => ({ p: [], vis: [], off: [] }));

    return { context, page, acc: read as PageAccumulators };
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
          try {
            await onProgress?.({ done, total: urls.length });
          } catch {
            // progress is best-effort
          }
        }),
      );
      if (measured.length === 0) {
        const failure = settled.find((r) => r.status === "rejected");
        throw failure && failure.status === "rejected"
          ? failure.reason
          : new Error("No pages could be audited.");
      }

      const pSet = new Set<string>();
      const visSet = new Set<string>();
      const offSet = new Set<string>();
      for (const { acc } of measured) {
        acc.p.forEach((x) => pSet.add(x));
        acc.vis.forEach((x) => visSet.add(x));
        acc.off.forEach((x) => offSet.add(x));
      }

      // The script's own cross-page check (an off-screen selector is not
      // hidden if it is a visible section somewhere) needs every page's DOM;
      // pages were audited in isolation, so redo it here across all of them.
      const offList = [...offSet];
      const visibleHits = await Promise.all(
        measured.map(({ page }) => selectorsVisibleOnPage(page, offList)),
      );
      visibleHits.forEach((hits) => hits.forEach((x) => visSet.add(x)));

      return {
        deferArray: [...pSet].sort(),
        hideSelectors: offList.filter((x) => !visSet.has(x)).sort(),
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
