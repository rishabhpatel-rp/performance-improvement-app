import { json, readInternalSecret } from "../lib/internal-request.ts";
import { decideInternalStorefrontRequest } from "../lib/internal-storefront-route.ts";
import { applyStorefrontLists, toggleStorefrontFamily } from "../lib/store-sync-audit.server";
import { familyFromField } from "../lib/storefront-lists";
import { applyScriptTokenAction } from "../lib/step2-actions.server.ts";
import { withStep2Echo } from "../lib/step2-config.server";
import { safeLogActivity } from "../lib/dashboard-helpers.server.ts";
import { reconcileScriptMetafield } from "../lib/script-metafield.server";
import { ensureAdminManaged } from "../lib/admin-managed.server.ts";

const RESYNC_STATUSES = new Set(["written", "cleared", "noop", "failed"]);

const NOT_FOUND = { ok: false, error: "Store record not found." };

/**
 * Every intent follows the same shape: perform the write, lock the shop for
 * the admin, log once with the acting admin, and echo the stored config.
 * A handler returns `{ response }` to short-circuit with a plain reply.
 */
const INTENTS = {
  resync: async ({ shopDomain }) => {
    const sync = await reconcileScriptMetafield(shopDomain, { force: true });
    const metafieldStatus = RESYNC_STATUSES.has(sync.status) ? sync.status : "failed";
    return {
      description: "admin requested metafield resync",
      meta: { metafieldStatus },
      body: { metafieldStatus },
    };
  },

  toggle: async ({ shopDomain, write }) => {
    const family = familyFromField(write.field);
    if (!family) return { response: [{ ok: false, error: "Invalid field." }, 400] };
    const result = await toggleStorefrontFamily(shopDomain, family, write.enabled);
    if (!result) return { response: [NOT_FOUND, 404] };
    return {
      description: `admin edited ${write.field} (toggle ${write.enabled ? "on" : "off"})`,
      meta: { field: write.field, enabled: write.enabled },
      body: {
        metafieldStatus: result.metafieldStatus,
        field: write.field,
        enabled: result.enabled,
      },
    };
  },

  "script-token-action": async ({ shopDomain, write }) => {
    const result = await applyScriptTokenAction(
      shopDomain,
      write.scope,
      write.token,
      write.actionName,
    );
    if (!result.ok) return { response: [{ ok: false, error: result.error }, result.status] };
    if (result.noop) return { response: [{ ok: true, noop: true }, 200] };
    return {
      description: `admin script action ${write.actionName} on ${write.token} (${write.scope})`,
      meta: {
        token: write.token,
        action: write.actionName,
        scope: write.scope,
      },
      body: {
        metafieldStatus: result.metafieldStatus,
        scope: write.scope,
        token: write.token,
        action: write.actionName,
      },
    };
  },

  "save-lists": async ({ shopDomain, write }) => {
    const result = await applyStorefrontLists(shopDomain, write.scope, write.patch);
    if (!result) return { response: [NOT_FOUND, 404] };
    return {
      description: `admin saved storefront lists (${write.scope})`,
      meta: { scope: write.scope, keys: Object.keys(write.patch) },
      body: { metafieldStatus: result.metafieldStatus, scope: write.scope },
    };
  },
};

async function runWrite(write) {
  const { shopDomain } = write;
  const outcome = await INTENTS[write.kind]({ shopDomain, write });
  if (outcome.response) return json(...outcome.response);

  await ensureAdminManaged(shopDomain);
  await safeLogActivity(shopDomain, "config_changed", outcome.description, {
    by: "admin-panel",
    actor: write.actorEmail,
    ...outcome.meta,
  });
  return json(
    await withStep2Echo(shopDomain, {
      ok: true,
      intent: write.kind,
      ...outcome.body,
    }),
  );
}

export const action = async ({ request }) => {
  const decision = await decideInternalStorefrontRequest(request, readInternalSecret());
  if (!decision.write) return json(decision.body, decision.status);
  return runWrite(decision.write);
};
