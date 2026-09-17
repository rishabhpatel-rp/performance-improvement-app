import { chromium } from "playwright";
import { buildAuditScriptWithPages } from "./audit-script";

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

/** Fetches the id of the store's most-recently-updated theme, used as the
 * `preview_theme_id` param for the storefront-password bypass URL. Returns
 * undefined (rather than throwing) if the lookup fails, so callers can fall
 * back to a bypass URL without a theme id. */
export async function getActiveThemeId(
  admin: AdminClient,
): Promise<string | undefined> {
  try {
    const data = await graphqlJson(
      admin,
      `#graphql
      query ActiveTheme {
        themes(first: 1, sortKey: UPDATED_AT) {
          edges { node { id } }
        }
      }`,
    );
    const id = data.themes?.edges?.[0]?.node?.id as string | undefined;
    // "gid://shopify/Theme/123456" -> "123456"
    return id ? id.split("/").pop() : undefined;
  } catch (err) {
    console.warn(
      "[audit] Failed to fetch theme id:",
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

/** Appends Shopify's documented programmatic storefront-password bypass
 * query params (`?password=...&preview_theme_id=...`) to a storefront URL,
 * so the hidden audit's headless browser can access a password-protected
 * store using the password the store owner entered in Step 1. `themeId` (from `getActiveThemeId`) is optional and only refines
 * the bypass — a password alone is enough for it to work. */
export function appendPasswordBypass(
  url: string,
  password: string,
  themeId?: string,
): string {
  const u = new URL(url);
  if (password) u.searchParams.set("password", password);
  if (themeId) u.searchParams.set("preview_theme_id", themeId);
  return u.toString();
}

/** Discover Home / PLP / PDP URLs for a store, preferring clean handles via
 * the Admin GraphQL API, and falling back to scraping the storefront.
 *
 * When `password` is provided (the store owner's own storefront password,
 * saved in Step 1 for a password-protected store), each URL is rewritten
 * with Shopify's documented `?password=` bypass so the hidden audit's
 * headless browser lands on the real storefront instead of the password
 * page. `themeId` (from `getActiveThemeId`) is optional and only refines
 * the bypass — a password alone is enough for it to work. */
export async function discoverPages(
  admin: AdminClient,
  shopDomain: string,
  password?: string,
  themeId?: string,
  customUrls?: CustomUrls,
): Promise<DiscoveredPages> {
  const home = `https://${shopDomain}/`;

  let plp: string | undefined;
  let pdp: string | undefined;

  // Use custom URLs if provided
  if (customUrls?.plp) plp = customUrls.plp;
  if (customUrls?.pdp) pdp = customUrls.pdp;

  // Only discover via GraphQL if custom URLs not provided
  if (!plp || !pdp) {
    try {
      const data = await graphqlJson(
        admin,
        `#graphql
        query PageDiscovery {
          collections(first: 1) {
            edges { node { handle } }
          }
          products(first: 1) {
            edges { node { handle } }
          }
        }`,
      );
      const collHandle = data.collections?.edges?.[0]?.node?.handle;
      const prodHandle = data.products?.edges?.[0]?.node?.handle;
      if (!plp && collHandle) plp = `https://${shopDomain}/collections/${collHandle}`;
      if (!pdp && prodHandle) pdp = `https://${shopDomain}/products/${prodHandle}`;
    } catch (err) {
      console.warn(
        "[audit] GraphQL page discovery failed, falling back to scrape:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Fallback: scrape the homepage for a collection + product link.
  if (!plp || !pdp) {
    try {
      const browser = await chromium.launch({
        headless: true,
        executablePath: chromiumExecutablePath(),
      });
      const page = await browser.newPage();
      const scrapeUrl = password
        ? appendPasswordBypass(home, password, themeId)
        : home;
      await page.goto(scrapeUrl, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });
      if (!plp) {
        // Extended PLP selectors for better compatibility
        const plpSelectors = [
          'a[href*="/collections/"]',
          'a[href*="/collections/all"]',
          'a[href*="/shop"]',
          'a[href*="/catalog"]',
          'a[href*="/collection"]',
        ];
        for (const selector of plpSelectors) {
          const href = await page
            .locator(selector)
            .first()
            .getAttribute("href")
            .then((h) => (h ? new URL(h, home).toString() : undefined))
            .catch(() => undefined);
          if (href) {
            plp = href;
            break;
          }
        }
      }
      if (!pdp) {
        // Extended PDP selectors for better compatibility
        const pdpSelectors = [
          'a[href*="/products/"]',
          'a[href*="/product/"]',
        ];
        for (const selector of pdpSelectors) {
          const href = await page
            .locator(selector)
            .first()
            .getAttribute("href")
            .then((h) => (h ? new URL(h, home).toString() : undefined))
            .catch(() => undefined);
          if (href) {
            pdp = href;
            break;
          }
        }
      }
      await browser.close();
    } catch (err) {
      console.warn(
        "[audit] Homepage scrape fallback failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Graceful degradation: continue with whatever pages were discovered (minimum home)
  if (!plp && !pdp) {
    console.warn("[audit] Only home page discovered, auditing home only");
  }

  if (password) {
    return {
      home: appendPasswordBypass(home, password, themeId),
      plp: plp ? appendPasswordBypass(plp, password, themeId) : undefined,
      pdp: pdp ? appendPasswordBypass(pdp, password, themeId) : undefined,
    };
  }

  return { home, plp, pdp };
}

/** Runs the verbatim audit script hidden in headless Chromium against the
 * discovered pages, using a persistent context so localStorage (the script's
 * accumulators) persists across page navigation like a real visitor. */
export type AuditProgress = {
  pageIndex: number; // 0-based index of the page currently being audited
  total: number; // total pages to audit
};

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
  onProgress?: (progress: AuditProgress) => void;
}): Promise<HiddenAuditResult> {
  const urls = [pages.home, pages.plp, pages.pdp].filter(
    (u): u is string => Boolean(u),
  );

  const browser = await chromium.launch({
    headless: true,
    executablePath: chromiumExecutablePath(),
  });

  try {
    // The verbatim audit script self-navigates through PAGES and persists its
    // accumulators in localStorage. We inject it with addInitScript so it runs
    // automatically on every load (the script tag does not survive navigation),
    // then navigate to the first page and wait for it to walk Home -> PLP -> PDP.
    const context = await browser.newContext();
    const page = await context.newPage();

    const script = buildAuditScriptWithPages(urls);
    await page.addInitScript({ content: script });

    try {
      await page.goto(urls[0], { waitUntil: "networkidle", timeout: 60000 });

      // Compound check: some password-protected stores don't honor the
      // `?password=` query param on every request path, so as a fallback we
      // detect the password page and submit the password form directly.
      if (password) {
        const isPasswordPage = await page.evaluate(() => {
          const form = document.querySelector(
            'form[action="/password"], form[action*="password"]',
          );
          const input = document.querySelector('input[name="password"]');
          return Boolean(form || input);
        });
        if (isPasswordPage) {
          console.log(
            "[audit] Password page detected — submitting bypass form.",
          );
          await page
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
            .catch(() => {});
          await page
            .waitForNavigation({ waitUntil: "networkidle", timeout: 30000 })
            .catch(() => {});
        }
      }
    } catch (err) {
      console.log(
        `[audit] Initial page failed (${urls[0]}):`,
        err instanceof Error ? err.message : err,
      );
    }

    // Wait for the audit to walk all pages. Worst case: PAGES.length * WAIT_MS
    // + navigation overhead + a safety margin for slower stores.
    const maxWaitMs = urls.length * 30000 + 60000;

    // Let the caller (dashboard / status API) track per-page progress while the
    // script walks Home -> PLP -> PDP, by reading the script's own accumulator
    // (STORE_KEY.currentIndex) from localStorage on an interval.
    let progressStopped = false;
    const progressPoller = (async () => {
      while (!progressStopped) {
        try {
          const ci = await page.evaluate(
            (key) => {
              try {
                const s = JSON.parse(localStorage.getItem(key) || "{}");
                return typeof s.currentIndex === "number" ? s.currentIndex : 0;
              } catch {
                return 0;
              }
            },
            STORE_KEY,
          );
          onProgress?.({
            pageIndex: Math.max(0, Math.min(ci, urls.length)),
            total: urls.length,
          });
        } catch {
          // page may be mid-navigation or closed; ignore transient failures
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
    })();

    await page
      .waitForFunction(
        ({ STORE_KEY, count }) => {
          try {
            const state = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
            return (
              typeof state.currentIndex === "number" &&
              state.currentIndex >= count
            );
          } catch {
            return false;
          }
        },
        { STORE_KEY, count: urls.length },
        { timeout: maxWaitMs },
      )
      .catch(() => {
        console.warn("[audit] Timed out waiting for audit walk to complete.");
      });
    progressStopped = true;
    await progressPoller.catch(() => {});

    // Read the script's accumulator localStorage from the store origin.
    await page.goto(urls[0], { waitUntil: "domcontentloaded", timeout: 60000 });

    const read = await page.evaluate(
      ([P_KEY, VIS_KEY, OFF_KEY]) => {
        const load = (k: string) => {
          try {
            return JSON.parse(localStorage.getItem(k) || "[]");
          } catch {
            return [];
          }
        };
        return {
          p: load(P_KEY),
          vis: load(VIS_KEY),
          off: load(OFF_KEY),
        };
      },
      [P_KEY, VIS_KEY, OFF_KEY],
    );

    const visSet: Record<string, number> = {};
    const offSet: Record<string, number> = {};
    (read.off as string[]).forEach((s) => (offSet[s] = 1));
    (read.vis as string[]).forEach((s) => (visSet[s] = 1));

    const deferArray = (read.p as string[]).sort();
    const hideSelectors = Object.keys(offSet)
      .filter((s) => !visSet[s])
      .sort();

    return {
      deferArray,
      hideSelectors,
      pagesAudited: urls,
      completedAt: new Date().toISOString(),
    };
  } finally {
    await browser.close();
  }
}
