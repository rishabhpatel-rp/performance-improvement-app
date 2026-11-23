/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
/**
 * Shared plumbing for the admin-panel -> merchant-app internal API.
 *
 * Every `/api/internal/*` route does the same four things before it may touch
 * the database: require POST, check the shared secret, parse JSON and require a
 * `shopDomain`. They live here so the routes cannot drift apart.
 *
 * Plain JS with no framework imports, so node:test can import it directly.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const INTERNAL_HEADER = "x-pagepulse-internal";

/** JSON `Response` helper shared by every internal route. */
export function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A rejected decision: `write: null` means the caller must not touch Prisma. */
export function reject(status: any, error: any) {
  return { status, body: { ok: false, error }, write: null };
}

/** An accepted decision carrying the write the route should perform. */
export function accept(write: any) {
  return { status: 200, body: null, write };
}

/**
 * Env names accepted for the shared secret, in priority order. The admin panel
 * documents `ADMIN_INTERNAL_SECRET`; the merchant app historically used
 * `INTERNAL_API_SECRET`. Accepting both keeps the two `.env` files in sync
 * whichever name an operator copies from `.env.example`.
 */
export const INTERNAL_SECRET_ENV_NAMES = ["INTERNAL_API_SECRET", "ADMIN_INTERNAL_SECRET"];

/**
 * Process env first. Outside production the project `.env` is read as a
 * fallback so a dev server sees a secret added after boot; production reads
 * the process environment only (no synchronous file I/O on a request path).
 */
export function readInternalSecret(
  env = process.env,
  envFile = path.resolve(process.cwd(), ".env"),
) {
  for (const name of INTERNAL_SECRET_ENV_NAMES) {
    const value = env[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  if (env.NODE_ENV === "production") return "";
  try {
    const rows = fs.readFileSync(envFile, "utf8").split(/\r?\n/);
    for (const name of INTERNAL_SECRET_ENV_NAMES) {
      const row = rows.find((line) => line.startsWith(`${name}=`));
      if (row) {
        return row
          .slice(name.length + 1)
          .trim()
          .replace(/^"|"$/g, "");
      }
    }
    return "";
  } catch {
    return "";
  }
}

/** Whether a header matches the shared internal secret. A missing secret never matches. */
export function internalAuthOk(headerValue: any, secret: any) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  if (typeof headerValue !== "string") return false;
  const a = Buffer.from(headerValue, "utf8");
  const b = Buffer.from(secret, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Method, secret and JSON-body gate shared by all internal routes.
 *
 * @param {Request} request
 * @param {string | undefined} secret
 * @param {{ shopError?: string }} [options] message used when `shopDomain` is empty
 * @returns {Promise<
 *   | { ok: true, body: Record<string, any>, shopDomain: string }
 *   | { ok: false, rejection: ReturnType<typeof reject> }
 * >}
 */
export async function parseInternalRequest(request: any, secret: any, options = {}) {
  if (request.method !== "POST") {
    return { ok: false, rejection: reject(405, "POST only") };
  }
  if (!internalAuthOk(request.headers.get(INTERNAL_HEADER), secret)) {
    return { ok: false, rejection: reject(401, "Unauthorized") };
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return { ok: false, rejection: reject(400, "Invalid JSON") };
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, rejection: reject(400, "Invalid JSON") };
  }

  const shopDomain = String(body.shopDomain || "").trim();
  if (!shopDomain) {
    return {
      ok: false,
      rejection: reject(400, (options as any).shopError ?? "Missing shopDomain."),
    };
  }
  return { ok: true, body, shopDomain };
}

/** Optional actor e-mail forwarded by the admin panel for the activity log. */
export function readActorEmail(body: any) {
  return typeof body?.actorEmail === "string" && body.actorEmail ? body.actorEmail : null;
}
