import { findPagesInHtml, pickPagesFromDiscovery, type DiscoveryData } from "./audit-discovery.ts";
import { HOME_FETCH_TIMEOUT_MS } from "./audit-timing.ts";
import { MAX_EXTRA_PAGES } from "./constants.ts";
import { logger } from "./logger.ts";
import { normalizeCustomUrl } from "./page-urls.server";
import {
  graphqlJson,
  isPasswordPageHtml,
  returnToRequestedUrl,
  unlockPasswordPage,
  withBrowser,
} from "./audit-browser.ts";
import {
  AdminClient,
  AuditBlockedError,
  CustomUrls,
  DiscoveredPages,
  appendPreviewParams,
} from "./audit-core.ts";

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

/** True when a fetched page is Shopify's storefront password page. */
export async function discoverViaHtml(
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
    return findPagesInHtml(html, home);
  } catch {
    return {};
  }
}

/** Fallback 2 (last resort): render the homepage in the shared browser. */
export async function discoverViaBrowser(
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
              .then((h) => {
                if (!h) return undefined;
                const candidate = new URL(h, home);
                return candidate.host === new URL(home).host ? candidate.toString() : undefined;
              })
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
                'a[href*="/categories/"]',
                'a[href*="/category/"]',
                'a[href*="/c/"]',
              ])
            : undefined,
          pdp: need.pdp
            ? await firstHref([
                'a[href*="/products/"]',
                'a[href*="/product/"]',
                'a[href*="/produto/"]',
                'a[href*="/item/"]',
                'a[href*="/p/"]',
              ])
            : undefined,
        };
      } finally {
        await context.close().catch(() => {});
      }
    });
  } catch (err) {
    logger.warn(
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
  const allowedHosts = await import("../db.server").then(({ default: db }) =>
    db.store
      .findUnique({ where: { shopDomain }, select: { primaryDomain: true } })
      .then((row: { primaryDomain: string | null }) =>
        row?.primaryDomain ? [row.primaryDomain] : [],
      )
      .catch(() => []),
  );

  // Merchant-typed URLs are validated again here so a bad saved value can never
  // fail the audit, and the store password is never sent to another host.
  const customFor = (kind: "plp" | "pdp", raw?: string): string | undefined => {
    const r = normalizeCustomUrl(raw, shopDomain, kind, allowedHosts);
    if (!r.ok) {
      logger.warn(`[audit] Ignoring invalid custom ${kind} URL: ${r.error}`);
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
    const r = normalizeCustomUrl(raw, shopDomain, "page", allowedHosts);
    if (!r.ok) {
      logger.warn(`[audit] Ignoring invalid extra page URL: ${r.error}`);
      continue;
    }
    if (!r.url) continue;
    // The homepage and the PLP/PDP are already measured; measuring them twice
    // would double-count and waste a page load.
    if (r.url === `https://${shopHost}/` || r.url === plp || r.url === pdp) continue;
    if (!extras.includes(r.url)) extras.push(r.url);
    if (extras.length >= MAX_EXTRA_PAGES) {
      logger.warn(`[audit] Extra page limit (${MAX_EXTRA_PAGES}) reached; the rest were ignored.`);
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
      logger.error(
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

  logger.info(`[audit] Page sources for ${shopDomain}: plp=${source.plp}, pdp=${source.pdp}`);

  const probePaths = ["/search", "/cart", "/blogs/news"];
  for (const path of probePaths) {
    if (extras.length >= MAX_EXTRA_PAGES) break;
    const url = `https://${shopDomain}${path}`;
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const already = extras.some((e) => {
        try {
          return new URL(e).pathname === path;
        } catch {
          return false;
        }
      });
      if (!already) extras.push(url);
    } catch {
      // optional storefront route — skip
    }
  }

  // Graceful degradation: continue with whatever pages were discovered (minimum home)
  if (!plp && !pdp) {
    logger.warn("[audit] Only home page discovered, auditing home only");
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
