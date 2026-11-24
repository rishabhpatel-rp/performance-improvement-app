import dns from "node:dns/promises";
import { isIP } from "node:net";

export type ParsedCustomAuditUrl =
  { ok: true; url: string; host: string } | { ok: false; error: string };

const STRIPPED_PARAMS = ["password", "preview_theme_id", "_bt", "_ab", "_fd", "_sc", "key"];

export function parseCustomAuditUrl(raw: unknown): ParsedCustomAuditUrl {
  const text = String(raw ?? "").trim();
  if (!text) return { ok: false, error: "Enter a URL to scan." };
  if (text.length > 2000) return { ok: false, error: "That URL is too long." };

  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { ok: false, error: "Enter a valid URL, for example https://example.com." };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Only http and https URLs can be scanned." };
  }
  if (url.username || url.password) {
    return { ok: false, error: "Remove credentials from the URL." };
  }
  if (!url.hostname) return { ok: false, error: "Enter a valid URL." };

  url.hash = "";
  for (const param of STRIPPED_PARAMS) url.searchParams.delete(param);
  if (!url.pathname || url.pathname === "") url.pathname = "/";

  return { ok: true, url: url.toString(), host: url.hostname.toLowerCase() };
}

function isPrivateAddress(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "").toLowerCase();
  if (
    ip === "::1" ||
    ip === "::" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80")
  ) {
    return true;
  }
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  const v4 = mapped ? mapped[1] : ip;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(v4)) return false;
  const [a, b] = v4.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

export async function assertPublicHost(url: string): Promise<string | null> {
  if (process.env.CUSTOM_AUDIT_ALLOW_PRIVATE_HOSTS === "1") return null;
  const parsed = parseCustomAuditUrl(url);
  if (!parsed.ok) return parsed.error;
  const host = parsed.host;
  if (isIP(host)) return isPrivateAddress(host) ? "Private network hosts cannot be scanned." : null;
  try {
    const addresses = await dns.lookup(host, { all: true });
    if (addresses.length === 0 || addresses.every((entry) => isPrivateAddress(entry.address))) {
      return "That host does not resolve to a public address.";
    }
  } catch {
    return "That host could not be resolved.";
  }
  return null;
}

export async function sanitizeRedirect(
  fromUrl: string,
  toUrl: string,
): Promise<{ ok: boolean; url?: string; error?: string }> {
  const parsed = parseCustomAuditUrl(toUrl);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  let from: URL;
  try {
    from = new URL(fromUrl);
  } catch {
    return { ok: false, error: "Invalid redirect source." };
  }
  const target = new URL(parsed.url);
  const sameOrigin = target.protocol === from.protocol && target.host === from.host;
  if (!sameOrigin) {
    const problem = await assertPublicHost(target.toString());
    if (problem) return { ok: false, error: problem };
  }
  target.username = "";
  target.password = "";
  target.hash = "";
  for (const param of STRIPPED_PARAMS) target.searchParams.delete(param);
  return { ok: true, url: target.toString() };
}
