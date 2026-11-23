/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
/**
 * Decides an internal store-control request before anything is executed.
 * The route calls this first; a result with `write: null` must not touch
 * Prisma or the Shopify Admin API.
 */

import { accept, parseInternalRequest, readActorEmail, reject } from "./internal-request.ts";

export { readInternalSecret } from "./internal-request.ts";

/** Intents with no payload beyond the shop and the acting admin. */
const SIMPLE_INTENTS = new Set(["start-audit", "stop-audit", "retry-head-inject"]);

/**
 * Force-ON skips the theme-embed and password checks, so production refuses it
 * unless the operator opted in with `ADMIN_ALLOW_FORCE_APP_ON=true`.
 */
function forceOnAllowed(env: any) {
  return env.NODE_ENV !== "production" || env.ADMIN_ALLOW_FORCE_APP_ON === "true";
}

/**
 * @param {Request} request
 * @param {string | undefined} secret
 * @param {Record<string, string | undefined>} [env] injectable for tests
 */
export async function decideInternalStoreControlRequest(
  request: any,
  secret: any,
  env = process.env,
) {
  const parsed = await parseInternalRequest(request, secret);
  if (!parsed.ok) return parsed.rejection;

  const { body, shopDomain } = parsed;
  const intent = String(body.intent || "");
  const actorEmail = readActorEmail(body);

  if (SIMPLE_INTENTS.has(intent)) {
    return accept({ kind: intent, shopDomain, actorEmail });
  }

  if (intent === "toggle-app") {
    if (typeof body.appEnabled !== "boolean") {
      return reject(400, "appEnabled must be a boolean.");
    }
    const force = body.force === true && body.appEnabled === true;
    if (force && !forceOnAllowed(env)) {
      return reject(400, "Force ON is disabled (set ADMIN_ALLOW_FORCE_APP_ON=true).");
    }
    return accept({
      kind: intent,
      shopDomain,
      appEnabled: body.appEnabled,
      force,
      actorEmail,
    });
  }

  if (intent === "set-admin-managed") {
    if (typeof body.adminManaged !== "boolean") {
      return reject(400, "adminManaged must be a boolean.");
    }
    return accept({
      kind: intent,
      shopDomain,
      adminManaged: body.adminManaged,
      actorEmail,
    });
  }

  return reject(400, "Invalid intent.");
}
