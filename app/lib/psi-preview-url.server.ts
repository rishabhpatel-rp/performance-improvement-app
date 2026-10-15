/** Query params copied from a theme editor / Share preview link for PSI on password stores. */

export type PsiPreviewBypassParams = Record<string, string>;

const REQUIRED_KEYS = ["_bt", "key"] as const;
const OPTIONAL_KEYS = ["preview_theme_id", "_ab", "_fd", "_sc"] as const;
const ALLOWED_KEYS = new Set<string>([...REQUIRED_KEYS, ...OPTIONAL_KEYS]);

export function hasPsiPreviewBypass(
  params: PsiPreviewBypassParams | null | undefined,
): boolean {
  if (!params || typeof params !== "object") return false;
  return REQUIRED_KEYS.every((k) => typeof params[k] === "string" && params[k].length > 0);
}

export function shouldSkipPsiForPasswordStore(
  isPasswordProtected: boolean | null | undefined,
): boolean {
  return isPasswordProtected === true;
}

export function parseThemePreviewShareUrl(
  input: unknown,
  shopDomain: string,
): { ok: true; params: PsiPreviewBypassParams } | { ok: false; error: string } {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: true, params: {} };

  const shopHost = shopDomain.toLowerCase();
  let u: URL;
  try {
    if (raw.startsWith("/") && !raw.startsWith("//")) {
      u = new URL(raw, `https://${shopHost}`);
    } else if (/^https?:\/\//i.test(raw)) {
      u = new URL(raw);
    } else {
      u = new URL(`https://${raw.replace(/^\/+/, "")}`);
    }
  } catch {
    return {
      ok: false,
      error:
        "Paste the full preview link from the theme editor (Share preview or View your store).",
    };
  }

  if (u.hostname.toLowerCase() !== shopHost || u.port) {
    return {
      ok: false,
      error: `The link must be for your store (${shopHost}).`,
    };
  }

  const params: PsiPreviewBypassParams = {};
  for (const key of ALLOWED_KEYS) {
    const v = u.searchParams.get(key);
    if (v) params[key] = v;
  }

  if (!hasPsiPreviewBypass(params)) {
    return {
      ok: false,
      error:
        "This link is missing preview bypass params (_bt and key). Copy the link from Online store → Themes → … → Share preview (or View your store while previewing).",
    };
  }

  return { ok: true, params };
}

/** Append stored preview params to an audit page URL (no storefront password param). */
export function applyPsiPreviewBypass(
  pageUrl: string,
  bypass: PsiPreviewBypassParams,
): string {
  const u = new URL(pageUrl);
  u.searchParams.delete("password");
  for (const key of ALLOWED_KEYS) {
    u.searchParams.delete(key);
    const v = bypass[key];
    if (v) u.searchParams.set(key, v);
  }
  return u.href;
}

/** `_bt` embeds an ISO `exp` (Shopify permanent_password_bypass). */
export function previewBypassExpiresAt(
  params: PsiPreviewBypassParams,
): Date | null {
  const bt = params._bt;
  if (!bt) return null;
  const encoded = bt.split("--")[0];
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const m = decoded.match(/"exp":"([^"]+)"/);
    if (m) return new Date(m[1]);
  } catch {
    /* malformed token */
  }
  return null;
}

export function isPreviewBypassExpired(params: PsiPreviewBypassParams): boolean {
  const exp = previewBypassExpiresAt(params);
  return exp != null && exp.getTime() < Date.now();
}
