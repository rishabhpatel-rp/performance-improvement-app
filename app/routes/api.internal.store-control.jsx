import {
  decideInternalStoreControlRequest,
  readInternalSecret,
} from "../lib/internal-store-control-route.js";
import { resolveShopAdmin } from "../lib/internal-shop-session.server";
import {
  handleToggleApp,
  handleStartAudit,
  handleStopAudit,
} from "../lib/dashboard-actions-audit.server.js";
import { handleRetryHeadInject } from "../lib/dashboard-actions-theme.server.js";
import { setAdminManaged, ensureAdminManaged } from "../lib/admin-managed.server.js";
import { loadStep2WriteEcho } from "../lib/step2-config.server";
import { safeLogActivity } from "../lib/dashboard-helpers.server";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function appendEcho(shopDomain, payload) {
  const echo = await loadStep2WriteEcho(shopDomain);
  return echo ? { ...payload, ...echo } : payload;
}

async function writeDecision(decision) {
  const write = decision.write;
  const shopDomain = write.shopDomain;

  if (write.kind === "set-admin-managed") {
    const ok = await setAdminManaged(shopDomain, write.adminManaged);
    if (!ok) return json({ ok: false, error: "Store not found." }, 404);
    await safeLogActivity(
      shopDomain,
      "config_changed",
      write.adminManaged
        ? "Store locked for admin-only configuration"
        : "Store released to merchant self-service",
      { by: "admin-panel", adminManaged: write.adminManaged, actor: write.actorEmail },
    );
    return json(
      await appendEcho(shopDomain, {
        ok: true,
        adminManaged: write.adminManaged,
      }),
    );
  }

  const resolved = await resolveShopAdmin(shopDomain);
  if (!resolved.ok) {
    return json({ ok: false, error: resolved.error }, 503);
  }
  const { admin } = resolved;
  const session = { shop: shopDomain };

  if (write.kind === "toggle-app") {
    const formData = new FormData();
    formData.set("appEnabled", write.appEnabled ? "true" : "false");
    const result = await handleToggleApp({
      admin,
      session,
      formData,
      forceAppOn: write.force === true && write.appEnabled === true,
    });
    if (!result.ok) {
      return json(result, 400);
    }
    await ensureAdminManaged(shopDomain);
    await safeLogActivity(
      shopDomain,
      "config_changed",
      `Admin ${write.appEnabled ? "enabled" : "disabled"} app`,
      {
        by: "admin-panel",
        actor: write.actorEmail,
        force: write.force === true,
        forcedOnWithoutEmbed: result.forcedOnWithoutEmbed === true,
      },
    );
    return json(await appendEcho(shopDomain, { ...result, intent: "toggle-app" }));
  }

  if (write.kind === "start-audit") {
    const result = await handleStartAudit({ admin, session });
    if (!result.ok) {
      return json(result, 400);
    }
    await ensureAdminManaged(shopDomain);
    await safeLogActivity(shopDomain, "config_changed", "Admin started audit", {
      by: "admin-panel",
      actor: write.actorEmail,
    });
    return json(await appendEcho(shopDomain, { ...result, intent: "start-audit" }));
  }

  if (write.kind === "stop-audit") {
    const result = await handleStopAudit({ session });
    if (!result.ok) {
      return json(result, 400);
    }
    await safeLogActivity(shopDomain, "config_changed", "Admin stopped audit", {
      by: "admin-panel",
      actor: write.actorEmail,
    });
    return json(await appendEcho(shopDomain, { ...result, intent: "stop-audit" }));
  }

  if (write.kind === "retry-head-inject") {
    const result = await handleRetryHeadInject({ admin, session });
    return json(await appendEcho(shopDomain, { ...result, intent: "retry-head-inject" }));
  }

  return json({ ok: false, error: "Unhandled intent." }, 500);
}

export const action = async ({ request }) => {
  const decision = await decideInternalStoreControlRequest(
    request,
    readInternalSecret(),
  );
  if (decision.write === null) {
    return json(decision.body, decision.status);
  }
  return writeDecision(decision);
};