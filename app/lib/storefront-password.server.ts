import { getEnv } from "./env.server.ts";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { logger } from "./logger.ts";

const PREFIX = "enc:v1:";

function key(): Buffer | null {
  const secret = getEnv().STOREFRONT_PASSWORD_KEY.trim();
  if (!secret) return null;
  if (/^[0-9a-fA-F]{64}$/.test(secret)) return Buffer.from(secret, "hex");
  return createHash("sha256").update(secret).digest();
}

export function encryptStorefrontPassword(plaintext: string): string | null {
  if (!plaintext) return null;
  const k = key();
  if (!k) {
    logger.warn("[password] STOREFRONT_PASSWORD_KEY is unset; storing the password as-is.");
    return plaintext;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", k, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, encrypted]).toString("base64url")}`;
}

export function decryptStorefrontPassword(stored: string | null | undefined): string | null {
  if (!stored) return null;
  if (!stored.startsWith(PREFIX)) return stored;
  const k = key();
  if (!k) {
    logger.error("[password] STOREFRONT_PASSWORD_KEY is unset; cannot read saved password.");
    return null;
  }
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64url");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", k, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  } catch (err) {
    logger.error("[password] Could not decrypt saved password:", err);
    return null;
  }
}

export function passwordLooksEncrypted(stored: string | null | undefined): boolean {
  return Boolean(stored?.startsWith(PREFIX));
}
