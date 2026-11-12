/**
 * Decides an internal storefront-list request before any database write.
 * The route calls this first. A result with `write: null` must not touch Prisma.
 */

import { internalAuthOk } from "./scan-summary-scope.js";
import fs from "node:fs";
import path from "node:path";

const SCOPES = new Set(["global", "home", "collection", "product"]);

/** Process env first, then the project `.env`, so a running dev server sees a secret added after boot. */
export function readInternalSecret(env = process.env, envFile = path.resolve(process.cwd(), ".env")) {
  const fromProcess = env.INTERNAL_API_SECRET;
  if (typeof fromProcess === "string" && fromProcess.length > 0) return fromProcess;
  try {
    const text = fs.readFileSync(envFile, "utf8");
    const line = text.split("\n").find((row) => row.startsWith("INTERNAL_API_SECRET="));
    if (!line) return "";
    return line.slice("INTERNAL_API_SECRET=".length).trim().replace(/^"|"$/g, "");
  } catch {
    return "";
  }
}

function reject(status, error) {
  return { status, body: { ok: false, error }, write: null };
}

/**
 * @param {Request} request
 * @param {string | undefined} secret
 */
export async function decideInternalStorefrontRequest(request, secret) {
  if (request.method !== "POST") {
    return reject(405, "POST only");
  }
  if (!internalAuthOk(request.headers.get("x-pagepulse-internal"), secret)) {
    return reject(401, "Unauthorized");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return reject(400, "Invalid JSON");
  }

  const shopDomain = String(body?.shopDomain || "");
  const scope = String(body?.scope || "");
  const intent = String(body?.intent || "");
  if (!shopDomain || !SCOPES.has(scope)) {
    return reject(400, "Invalid shop or tab.");
  }

  if (intent === "toggle") {
    const field = String(body?.field || "");
    if (!field) return reject(400, "Invalid field.");
    return {
      status: 200,
      body: null,
      write: { kind: "toggle", shopDomain, field, enabled: body?.enabled === true },
    };
  }

  if (intent === "script-token-action") {
    const token = String(body?.token || "").trim();
    const actionName = String(body?.action || "");
    const allowed = ["defer", "delay_first", "delay_every", "protected"];
    if (!token || !allowed.includes(actionName)) {
      return reject(400, "Invalid action.");
    }
    return {
      status: 200,
      body: null,
      write: { kind: "script-token-action", shopDomain, scope, token, actionName },
    };
  }

  if (intent !== "save-lists") {
    return reject(400, "Invalid intent.");
  }

  const patch = body?.patch || {};
  const clean = {};
  for (const name of ["defer", "hide", "first", "every"]) {
    if (patch[name] == null) continue;
    if (!Array.isArray(patch[name]) || patch[name].some((item) => typeof item !== "string")) {
      return reject(400, "Each field must be a JSON array of strings.");
    }
    clean[name] = patch[name];
  }
  for (const name of ["firstMs", "everyMs"]) {
    if (patch[name] == null || patch[name] === "") continue;
    const ms = Number(patch[name]);
    if (!Number.isFinite(ms) || ms < 0) {
      return reject(400, "Delay must be zero or greater.");
    }
    clean[name] = ms;
  }
  if (Object.keys(clean).length === 0) {
    return reject(400, "No fields to save.");
  }

  return {
    status: 200,
    body: null,
    write: { kind: "save-lists", shopDomain, scope, patch: clean },
  };
}
