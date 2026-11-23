/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import prisma from "../db.server";
import { resolveShopAdmin } from "./internal-shop-session.server.ts";
import {
  ensureScriptDefinition,
  packAdminHeadHtml,
  writeAdminHeadMetafield,
} from "./script-inline.js";
import { withShopifyTimeout } from "./shopify-timeout.server";
import { safeLogActivity } from "./dashboard-helpers.server.ts";

export { packAdminHeadHtml, ADMIN_HEAD_MAX_CHARS } from "./script-inline.js";

const SHOPIFY_WRITE_TIMEOUT_MS = 10_000;

/**
 * Saves (or clears, when `html` is blank) the ops-only head HTML for a shop.
 *
 * Order matters: the storefront metafield is written before the database so a
 * failed Shopify call (missing session, API error) leaves the stored value
 * untouched and the admin UI keeps showing what is actually live.
 *
 * @param {string} shopDomain
 * @param {string} html
 * @param {string | null} [actorEmail]
 * @returns {Promise<{ ok: true, metafieldStatus: string } | { ok: false, error: string }>}
 */
export async function saveAdminHeadHtml(shopDomain: any, html: any, actorEmail = null) {
  const packed = packAdminHeadHtml(html);
  if (!packed.ok) return { ok: false, error: packed.reason };

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      isActive: true,
      configs: { select: { id: true }, take: 1 },
    },
  });
  if (!store) return { ok: false, error: "Store not found." };
  if (store.configs.length === 0) {
    return {
      ok: false,
      error: "Store has no config yet — merchant must open the app once.",
    };
  }

  const value = html.trim() ? html : null;
  let metafieldStatus = "skipped_inactive_store";

  if (store.isActive) {
    const resolved = await resolveShopAdmin(shopDomain);
    if (!resolved.ok) return { ok: false, error: resolved.error };

    try {
      await withShopifyTimeout(
        ensureScriptDefinition(resolved.admin),
        "ensureScriptDefinition",
        SHOPIFY_WRITE_TIMEOUT_MS,
      ).catch(() => undefined);
      await withShopifyTimeout(
        writeAdminHeadMetafield(resolved.admin, value ?? ""),
        "writeAdminHeadMetafield",
        SHOPIFY_WRITE_TIMEOUT_MS,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Metafield sync failed.";
      return { ok: false, error: message };
    }
    metafieldStatus = "written";
  }

  await prisma.storeConfig.updateMany({
    where: { storeId: store.id },
    data: { adminHeadHtml: value },
  });

  await safeLogActivity(
    shopDomain,
    "config_changed",
    value ? "Admin updated head HTML snippet" : "Admin cleared head HTML snippet",
    { by: "admin-panel", actor: actorEmail, bytes: value?.length ?? 0 },
  );

  return { ok: true, metafieldStatus };
}
