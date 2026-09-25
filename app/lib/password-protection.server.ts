import prisma from "../db.server";
import { withBrowser } from "./audit.server";
import { withShopifyTimeout } from "./shopify-timeout.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/** true = protected, false = confirmed not protected, null = could not tell. */
export type PasswordState = boolean | null;

// Generous on purpose: this never blocks the dashboard (it runs in the
// background), and "could not tell" must never be reported as "not protected".
const PROBE_TIMEOUT_MS = 10_000;
const API_TIMEOUT_MS = 8_000;

// `/password`, also locale-prefixed (`/fr/password`).
const PASSWORD_PATH = /(^|\/)password\/?$/;

/**
 * Decide from the FINAL response of the store's live URL (after every
 * redirect, incl. myshopify.com -> primary domain):
 *  - landed on /password            -> protected
 *  - normal page (HTTP 200)         -> not protected
 *  - anything else (403/429/503/404, missing response) -> unknown
 */
export function classifyStorefrontResponse(
  status: number | null,
  finalUrl: string | null,
): PasswordState {
  if (!finalUrl || status === null) return null;
  let pathname: string;
  try {
    pathname = new URL(finalUrl).pathname;
  } catch {
    return null;
  }
  if (PASSWORD_PATH.test(pathname)) return true;
  return status === 200 ? false : null;
}

/** Redirect-only check in the shared warm Chromium: `commit` fires as soon as
 * the final response starts, so the page is never rendered. */
async function probeWithBrowser(url: string): Promise<PasswordState> {
  return withBrowser(async (browser) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const response = await page.goto(url, {
        waitUntil: "commit",
        timeout: PROBE_TIMEOUT_MS,
      });
      return classifyStorefrontResponse(response ? response.status() : null, page.url());
    } catch {
      return null; // timeout / network error / blocked
    } finally {
      await context.close().catch(() => {});
    }
  });
}

/** Same check without a browser (used only if Chromium cannot launch). */
async function probeWithFetch(url: string): Promise<PasswordState> {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; PagePulseCheck/1.0)" },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await res.body?.cancel().catch(() => {});
    return classifyStorefrontResponse(res.status, res.url);
  } catch {
    return null;
  }
}

/** Does this URL end up on the password page? (exported for tests) */
export async function probeUrl(url: string): Promise<PasswordState> {
  try {
    return await probeWithBrowser(url);
  } catch {
    // withBrowser only throws when the browser itself is unavailable.
    return probeWithFetch(url);
  }
}

/** Does the store's live URL redirect to the password page? */
export function probeStorefront(shopDomain: string): Promise<PasswordState> {
  return probeUrl(`https://${shopDomain}/`);
}

/** Shopify's own setting. GraphQL `errors` or a timeout mean "unknown", never
 * "not protected". */
async function probeAdminApi(admin: AdminClient): Promise<PasswordState> {
  try {
    const response = await withShopifyTimeout<Response>(
      admin.graphql(`#graphql
        query OnlineStorePasswordStatus {
          onlineStore {
            passwordProtection {
              enabled
            }
          }
        }
      `),
      "passwordProtection",
      API_TIMEOUT_MS,
    );
    const json = await response.json();
    if (json.errors?.length) return null;
    const enabled = json.data?.onlineStore?.passwordProtection?.enabled;
    return typeof enabled === "boolean" ? enabled : null;
  } catch {
    return null;
  }
}

/** `true` if either signal says protected; `false` if one says not protected
 * and none says protected; otherwise `null` (could not tell). */
export function combineSignals(a: PasswordState, b: PasswordState): PasswordState {
  if (a === true || b === true) return true;
  if (a === false || b === false) return false;
  return null;
}

/** Runs both signals in parallel. */
export async function checkPasswordProtection(
  admin: AdminClient,
  shopDomain: string,
): Promise<PasswordState> {
  const [storefront, api] = await Promise.all([
    probeStorefront(shopDomain),
    probeAdminApi(admin),
  ]);
  return combineSignals(storefront, api);
}

async function saveState(shopDomain: string, state: boolean): Promise<void> {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!store) return;
  await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: { storeId: store.id, isPasswordProtected: state },
    update: { isPasswordProtected: state },
  });
}

// One probe per shop at a time (dashboard loads / polls can overlap).
const inFlight = new Map<string, Promise<PasswordState>>();

/** Checks and stores the result. Only a definite answer is written — an
 * unknown never overwrites what is cached. Never throws. */
export function refreshPasswordProtection(
  admin: AdminClient,
  shopDomain: string,
): Promise<PasswordState> {
  const existing = inFlight.get(shopDomain);
  if (existing) return existing;

  const run = (async (): Promise<PasswordState> => {
    try {
      const state = await checkPasswordProtection(admin, shopDomain);
      if (state !== null) await saveState(shopDomain, state);
      return state;
    } catch (err) {
      console.warn(
        `[password-protection] Check failed for ${shopDomain}:`,
        err instanceof Error ? err.message : err,
      );
      return null;
    } finally {
      inFlight.delete(shopDomain);
    }
  })();
  inFlight.set(shopDomain, run);
  return run;
}

/** The stored answer, or (if none yet) a live check. Used when the answer is
 * needed right now, e.g. when the merchant tries to turn the app on. */
export async function getPasswordProtection(
  admin: AdminClient,
  shopDomain: string,
): Promise<PasswordState> {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { configs: { select: { isPasswordProtected: true }, take: 1 } },
  });
  const cached = store?.configs?.[0]?.isPasswordProtected ?? null;
  if (cached !== null) return cached;
  return refreshPasswordProtection(admin, shopDomain);
}
