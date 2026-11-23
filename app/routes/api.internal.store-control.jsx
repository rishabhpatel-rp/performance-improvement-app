import { json, readInternalSecret } from "../lib/internal-request.ts";
import { decideInternalStoreControlRequest } from "../lib/internal-store-control-route.ts";
import { resolveShopAdmin } from "../lib/internal-shop-session.server.ts";
import {
  handleToggleApp,
  handleStartAudit,
  handleStopAudit,
} from "../lib/dashboard-actions-audit.server.ts";
import { handleRetryHeadInject } from "../lib/dashboard-actions-theme.server.ts";
import { setAdminManaged, ensureAdminManaged } from "../lib/admin-managed.server.ts";
import { withStep2Echo } from "../lib/step2-config.server";
import { safeLogActivity } from "../lib/dashboard-helpers.server.ts";

/** Attribution merged into the activity-log row the shared handlers write. */
const adminMeta = (write) => ({ by: "admin-panel", actor: write.actorEmail });

async function setLock(write) {
  const { shopDomain, adminManaged } = write;
  if (!(await setAdminManaged(shopDomain, adminManaged))) {
    return json({ ok: false, error: "Store not found." }, 404);
  }
  await safeLogActivity(
    shopDomain,
    "config_changed",
    adminManaged
      ? "Store locked for admin-only configuration"
      : "Store released to merchant self-service",
    { ...adminMeta(write), adminManaged },
  );
  return json(await withStep2Echo(shopDomain, { ok: true, adminManaged }));
}

/**
 * Runs one Shopify-backed intent. Writes that change what the merchant sees
 * lock the shop so the embedded app turns read-only (`ensureAdminManaged`).
 */
const SHOP_INTENTS = {
  "toggle-app": async ({ admin, session, write }) => {
    const formData = new FormData();
    formData.set("appEnabled", String(write.appEnabled));
    const result = await handleToggleApp({
      admin,
      session,
      formData,
      forceAppOn: write.force,
      activityMeta: { ...adminMeta(write), force: write.force },
    });
    if (result.ok) await ensureAdminManaged(session.shop);
    return result;
  },
  "start-audit": async ({ admin, session, write }) => {
    const result = await handleStartAudit({
      admin,
      session,
      activityMeta: adminMeta(write),
    });
    if (result.ok) await ensureAdminManaged(session.shop);
    return result;
  },
  "stop-audit": ({ session, write }) =>
    handleStopAudit({ session, activityMeta: adminMeta(write) }),
  "retry-head-inject": ({ admin, session }) => handleRetryHeadInject({ admin, session }),
};

async function runWrite(write) {
  if (write.kind === "set-admin-managed") return setLock(write);

  const run = SHOP_INTENTS[write.kind];
  if (!run) return json({ ok: false, error: "Unhandled intent." }, 500);

  const resolved = await resolveShopAdmin(write.shopDomain);
  if (!resolved.ok) return json({ ok: false, error: resolved.error }, 503);

  const result = await run({
    admin: resolved.admin,
    session: { shop: write.shopDomain },
    write,
  });
  // Business refusals (app_disabled, extension_required, ...) are a 400 the
  // admin UI shows verbatim; `retry-head-inject` always reports its own status.
  const status = result.ok === false ? 400 : 200;
  return json(await withStep2Echo(write.shopDomain, { ...result, intent: write.kind }), status);
}

export const action = async ({ request }) => {
  const decision = await decideInternalStoreControlRequest(request, readInternalSecret());
  if (decision.write === null) return json(decision.body, decision.status);
  return runWrite(decision.write);
};
