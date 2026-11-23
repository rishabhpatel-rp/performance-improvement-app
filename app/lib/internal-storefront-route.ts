/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
/**
 * Decides an internal storefront-list request before any database write.
 * The route calls this first; a result with `write: null` must not touch Prisma.
 */

import { accept, parseInternalRequest, readActorEmail, reject } from "./internal-request.ts";

export { readInternalSecret } from "./internal-request.ts";

export const SCOPES = new Set(["global", "home", "collection", "product"]);
export const TOKEN_ACTIONS = new Set(["defer", "delay_first", "delay_every", "protected"]);
const LIST_KEYS = ["defer", "hide", "first", "every"];
const DELAY_KEYS = ["firstMs", "everyMs"];
const MAX_LIST_ITEMS = 500;
const MAX_ITEM_CHARS = 300;

/**
 * Validates the `patch` of a `save-lists` request.
 * @returns {{ ok: true, patch: Record<string, unknown> } | { ok: false, error: string }}
 */
function cleanListsPatch(patch: any) {
  const source = patch && typeof patch === "object" ? patch : {};
  const clean: Record<string, any> = {};

  for (const name of LIST_KEYS) {
    const value = source[name];
    if (value == null) continue;
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
      return {
        ok: false,
        error: "Each field must be a JSON array of strings.",
      };
    }
    if (value.length > MAX_LIST_ITEMS) {
      return {
        ok: false,
        error: `Each list may contain at most ${MAX_LIST_ITEMS} items.`,
      };
    }
    if (value.some((item) => item.length > MAX_ITEM_CHARS)) {
      return {
        ok: false,
        error: `Each list item may be at most ${MAX_ITEM_CHARS} characters.`,
      };
    }
    clean[name] = value;
  }

  for (const name of DELAY_KEYS) {
    const value = source[name];
    if (value == null || value === "") continue;
    const ms = Number(value);
    if (!Number.isFinite(ms) || ms < 0) {
      return { ok: false, error: "Delay must be zero or greater." };
    }
    clean[name] = ms;
  }

  if (Object.keys(clean).length === 0) {
    return { ok: false, error: "No fields to save." };
  }
  return { ok: true, patch: clean };
}

/**
 * @param {Request} request
 * @param {string | undefined} secret
 */
export async function decideInternalStorefrontRequest(request: any, secret: any) {
  const parsed = await parseInternalRequest(request, secret);
  if (!parsed.ok) return parsed.rejection;

  const { body, shopDomain } = parsed;
  const intent = String(body.intent || "");
  const actorEmail = readActorEmail(body);

  if (intent === "resync") {
    return accept({ kind: "resync", shopDomain, actorEmail });
  }

  const scope = String(body.scope || "");
  if (!SCOPES.has(scope)) return reject(400, "Invalid tab.");

  if (intent === "toggle") {
    const field = String(body.field || "");
    if (!field) return reject(400, "Invalid field.");
    return accept({
      kind: "toggle",
      shopDomain,
      field,
      enabled: body.enabled === true,
      actorEmail,
    });
  }

  if (intent === "script-token-action") {
    const token = String(body.token || "").trim();
    const actionName = String(body.action || "");
    if (!token || !TOKEN_ACTIONS.has(actionName)) {
      return reject(400, "Invalid action.");
    }
    return accept({
      kind: "script-token-action",
      shopDomain,
      scope,
      token,
      actionName,
      actorEmail,
    });
  }

  if (intent === "save-lists") {
    const cleaned = cleanListsPatch(body.patch);
    if (!cleaned.ok) return reject(400, cleaned.error);
    return accept({
      kind: "save-lists",
      shopDomain,
      scope,
      patch: cleaned.patch,
      actorEmail,
    });
  }

  return reject(400, "Invalid intent.");
}
