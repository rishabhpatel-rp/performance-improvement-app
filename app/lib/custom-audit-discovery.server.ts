import {
  findGenericPagesInHtml,
  findPagesInSitemap,
  findPagesInStructuredData,
} from "./audit-discovery.ts";
import { isPasswordPageHtml } from "./audit-browser.ts";
import { appendPreviewParams, AuditBlockedError, type DiscoveredPages } from "./audit-core.ts";
import { HOME_FETCH_TIMEOUT_MS } from "./audit-timing.ts";
import { MAX_EXTRA_PAGES } from "./constants.ts";
import { logger } from "./logger.ts";
import { parseCustomAuditUrl, sanitizeRedirect } from "../../shared/custom-audit-url.ts";

const PROBE_PATHS = ["/collections", "/shop", "/catalog", "/products", "/search", "/cart"];

type Fetched = { html: string; finalUrl: string } | null;

async function fetchWithSafeRedirects(url: string): Promise<Fetched> {
  let current = url;
  for (let hop = 0; hop < 3; hop += 1) {
    try {
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0 (compatible; PagePulseAudit/1.0)" },
        signal: AbortSignal.timeout(HOME_FETCH_TIMEOUT_MS),
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) return null;
        const safe = await sanitizeRedirect(current, new URL(location, current).toString());
        if (!safe.ok || !safe.url) return null;
        current = safe.url;
        continue;
      }
      if (!res.ok) return null;
      return { html: await res.text(), finalUrl: current };
    } catch {
      return null;
    }
  }
  return null;
}

function sameHost(url: string | undefined, host: string): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase() === host ? url : undefined;
  } catch {
    return undefined;
  }
}

export async function discoverCustomAuditPages(
  rawUrl: string,
  password?: string,
): Promise<DiscoveredPages> {
  const parsed = parseCustomAuditUrl(rawUrl);
  if (!parsed.ok) throw new Error(parsed.error);

  const params = password ? { password } : {};
  const home = appendPreviewParams(parsed.url, params);
  const host = parsed.host;

  const fetched = await fetchWithSafeRedirects(home);
  const html = fetched?.html ?? "";
  const finalUrl = fetched?.finalUrl ?? home;

  if (html && isPasswordPageHtml(finalUrl, html) && !password) {
    throw new AuditBlockedError("PASSWORD_REQUIRED");
  }

  const htmlPages = findGenericPagesInHtml(html, finalUrl);
  let plp = sameHost(htmlPages.plp, host);
  let pdp = sameHost(htmlPages.pdp, host);

  if (!plp || !pdp) {
    const structured = findPagesInStructuredData(html, finalUrl);
    plp = plp ?? sameHost(structured.plp, host);
    pdp = pdp ?? sameHost(structured.pdp, host);
  }

  if (!plp || !pdp) {
    const { discoverViaBrowser } = await import("./audit-discovery-runtime.ts");
    const found = await discoverViaBrowser(home, { plp: !plp, pdp: !pdp }, password);
    plp = plp ?? sameHost(found.plp, host);
    pdp = pdp ?? sameHost(found.pdp, host);
  }

  const extras: string[] = [];
  const addExtra = (candidate: string | undefined) => {
    const url = sameHost(candidate, host);
    if (!url || extras.length >= MAX_EXTRA_PAGES) return;
    const pathname = new URL(url).pathname;
    if (pathname === "/" || pathname === new URL(home).pathname) return;
    if (pathname === (plp && new URL(plp).pathname)) return;
    if (pathname === (pdp && new URL(pdp).pathname)) return;
    if (!extras.some((extra) => new URL(extra).pathname === pathname)) extras.push(url);
  };

  if (!plp || !pdp) {
    const sitemapUrl = appendPreviewParams(new URL("/sitemap.xml", finalUrl).toString(), params);
    const sitemap = await fetchWithSafeRedirects(sitemapUrl);
    if (sitemap?.html.includes("<loc")) {
      const found = findPagesInSitemap(sitemap.html, finalUrl);
      plp = plp ?? sameHost(found.plp, host);
      pdp = pdp ?? sameHost(found.pdp, host);
      found.extras.forEach(addExtra);
    }
  }

  if ((!plp || !pdp) && extras.length < MAX_EXTRA_PAGES) {
    await Promise.all(
      PROBE_PATHS.map(async (path) => {
        try {
          const probe = appendPreviewParams(new URL(path, finalUrl).toString(), params);
          const res = await fetch(probe, {
            method: "HEAD",
            redirect: "follow",
            signal: AbortSignal.timeout(5000),
          });
          if (res.ok) addExtra(res.url || probe);
        } catch {
          /* a missing probe page is normal */
        }
      }),
    );
  }

  logger.info(
    `[custom-audit] Discovered pages: home=${new URL(home).pathname} plp=${plp ? new URL(plp).pathname : "none"} pdp=${pdp ? new URL(pdp).pathname : "none"} extras=${extras.length}`,
  );

  return { home, plp, pdp, extras };
}
