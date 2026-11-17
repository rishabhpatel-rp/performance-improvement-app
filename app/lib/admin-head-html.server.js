import prisma from "../db.server";
import { resolveShopAdmin } from "./internal-shop-session.server.js";
import {
  ensureScriptDefinition,
  packAdminHeadHtml,
  writeAdminHeadMetafield,
} from "./script-inline.js";
import { withShopifyTimeout } from "./shopify-timeout.server.js";
import { safeLogActivity } from "./dashboard-helpers.server.js";

export { packAdminHeadHtml, ADMIN_HEAD_MAX_CHARS } from "./script-inline.js";

export async function saveAdminHeadHtml(shopDomain, html, actorEmail) {
  const packed = packAdminHeadHtml(html);
  if (!packed.ok) {
    return { ok: false, error: packed.reason };
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, isActive: true },
  });
  if (!store) return { ok: false, error: "Store not found." };

  const trimmed = typeof html === "string" ? html : "";
  const value = trimmed.trim() ? trimmed : null;

  const updated = await prisma.storeConfig.updateMany({
    where: { storeId: store.id },
    data: { adminHeadHtml: value },
  });
  if (updated.count === 0) {
    return { ok: false, error: "Store has no config yet — merchant must open the app once." };
  }

  if (!store.isActive) {
    return { ok: true, metafieldStatus: "skipped_inactive_store" };
  }

  const resolved = await resolveShopAdmin(shopDomain);
  if (!resolved.ok) {
    return { ok: false, error: resolved.error };
  }

  try {
    await withShopifyTimeout(
      ensureScriptDefinition(resolved.admin),
      "ensureScriptDefinition",
      10_000,
    ).catch(() => undefined);
    await withShopifyTimeout(
      writeAdminHeadMetafield(resolved.admin, trimmed),
      "writeAdminHeadMetafield",
      10_000,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Metafield sync failed.";
    return { ok: false, error: message };
  }

  await safeLogActivity(shopDomain, "config_changed", "Admin updated head HTML snippet", {
    by: "admin-panel",
    actor: actorEmail ?? null,
    bytes: trimmed.length,
  });

  return { ok: true, metafieldStatus: "written" };
}