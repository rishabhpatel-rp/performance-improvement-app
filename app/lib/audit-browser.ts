import { getEnv } from "./env.server.ts";
import { logger } from "./logger.ts";
import { chromium, type Browser, type Page } from "playwright";
import { AdminClient } from "./audit-core.ts";

function chromiumExecutablePath(): string | undefined {
  const envPath = getEnv().CHROMIUM_PATH;
  return envPath || undefined;
}

// One Chromium is kept warm and shared by page discovery + the audit, instead
// of a ~1 s launch per use. Each audited page gets its own browser *context*
// (isolated localStorage/cookies), so the parallel pages never interfere.
// The browser closes itself after a period of no use to free memory.
const BROWSER_IDLE_CLOSE_MS = 10 * 1000;
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
    args: ["--disable-dev-shm-usage", "--disable-gpu", "--no-first-run", "--disable-extensions"],
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

export async function graphqlJson(admin: AdminClient, query: string) {
  const res = await admin.graphql(query);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: { message?: string }) => e.message).join("; "));
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
        return /(^|\/)password\/?$/.test(new URL(action, location.href).pathname);
      } catch {
        return /(^|\/)password\/?$/i.test(action);
      }
    })
    .catch(() => false);
}

export async function unlockPasswordPage(page: Page, password: string): Promise<boolean> {
  if (!(await isPasswordPage(page))) return false;

  logger.info("[audit] Password page detected — submitting bypass form.");
  const navigation = page
    .waitForNavigation({ waitUntil: "load", timeout: 30000 })
    .catch(() => undefined);
  const submitted = await page
    .evaluate((pw) => {
      const input = document.querySelector<HTMLInputElement>(
        'input[name="password"], input[type="password"]',
      );
      const form = (input?.closest("form") ??
        document.querySelector<HTMLFormElement>(
          'form[action*="password"], form',
        )) as HTMLFormElement | null;
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

/** Closes the shared Chromium on worker shutdown. */
export async function closeIdleBrowser(): Promise<void> {
  if (browserIdleTimer) {
    clearTimeout(browserIdleTimer);
    browserIdleTimer = null;
  }
  const closing = browserPromise;
  browserPromise = null;
  if (closing) await (await closing).close().catch(() => {});
}
