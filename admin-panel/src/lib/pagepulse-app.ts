/**
 * Server-to-server calls into the main PagePulse Remix app (rebuild + metafield sync).
 */
export function getPagePulseAppUrl(): string | null {
  const url =
    process.env.PAGEPULSE_APP_URL?.trim() ||
    process.env.PAGEPULSE_INTERNAL_URL?.trim();
  return url || null;
}

export function getAdminInternalSecret(): string | null {
  const secret =
    process.env.ADMIN_INTERNAL_SECRET?.trim() ||
    process.env.INTERNAL_API_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return secret;
}

export async function callPagePulseStoreConfigApi(
  shopDomain: string,
  payload: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const base = getPagePulseAppUrl();
  const secret = getAdminInternalSecret();
  if (!base || !secret) {
    return {
      ok: false,
      status: 503,
      body: {
        error:
          "Set PAGEPULSE_APP_URL (or PAGEPULSE_INTERNAL_URL) and ADMIN_INTERNAL_SECRET (or INTERNAL_API_SECRET) on the admin panel — same values as the merchant app.",
      },
    };
  }

  const url = `${base.replace(/\/$/, "")}/api/admin/store-config`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({ shopDomain, ...payload }),
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = { error: "Invalid response from PagePulse app" };
  }

  return { ok: res.ok, status: res.status, body };
}
