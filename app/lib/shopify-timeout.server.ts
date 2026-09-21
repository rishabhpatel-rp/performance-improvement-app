/** Fail-fast wrapper so a hung Admin API call cannot block the dashboard. */
export const SHOPIFY_CALL_TIMEOUT_MS = 3000;

export function withShopifyTimeout<T>(
  promise: Promise<T>,
  label: string,
  ms: number = SHOPIFY_CALL_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`[${label}] timed out after ${ms}ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}
