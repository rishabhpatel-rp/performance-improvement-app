export function envValue(key: string): string {
  const v = process.env[key];
  return typeof v === "string" ? v : "";
}

/** Merchant app origin — accepts either env name documented in admin-panel/.env.example. */
export function merchantInternalUrl(): string {
  const raw = envValue("PAGEPULSE_INTERNAL_URL") || envValue("PAGEPULSE_APP_URL");
  return raw.trim().replace(/\/+$/, "");
}

/** Upper bound for one merchant-app call; a hung upstream must not hang the BFF. */
const MERCHANT_TIMEOUT_MS = 15_000;

export function merchantInternalSecret(): string {
  return envValue("INTERNAL_API_SECRET") || envValue("ADMIN_INTERNAL_SECRET");
}

export async function callMerchantInternal<T = unknown>(
  path: string,
  body: Record<string, unknown>,
): Promise<{ res: Response; data: T | null }> {
  const internalUrl = merchantInternalUrl();
  if (!internalUrl) {
    throw new Error("PAGEPULSE_INTERNAL_URL or PAGEPULSE_APP_URL is not configured.");
  }
  let res: Response;
  try {
    res = await fetch(`${internalUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": merchantInternalSecret(),
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(MERCHANT_TIMEOUT_MS),
    });
  } catch (err) {
    const detail =
      err instanceof Error && err.name === "TimeoutError"
        ? `no response within ${MERCHANT_TIMEOUT_MS / 1000}s`
        : err instanceof Error
          ? err.message
          : "network error";
    throw new Error(
      `Cannot reach merchant app at ${internalUrl} (${detail}). Is shopify app dev running? Run: node scripts/sync-admin-merchant-url.mjs and restart admin-panel.`,
    );
  }
  const data = (await res.json().catch(() => null)) as T | null;
  return { res, data };
}
