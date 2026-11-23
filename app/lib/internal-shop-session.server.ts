/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import { unauthenticated } from "../shopify.server";

import { logger } from "./logger.ts";
/**
 * Offline Admin API client for a shop (internal control plane).
 * @returns {{ ok: true, admin: object, shopDomain: string } | { ok: false, error: string }}
 */
export async function resolveShopAdmin(shopDomain: any) {
  const shop = String(shopDomain || "").trim();
  if (!shop) {
    return { ok: false, error: "missing_shop_domain" };
  }
  try {
    const { admin } = await unauthenticated.admin(shop);
    if (!admin) {
      return { ok: false, error: "session_missing" };
    }
    return { ok: true, admin, shopDomain: shop };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/session|token|not found|401/i.test(msg)) {
      return { ok: false, error: "session_missing" };
    }
    logger.warn("[internal-shop-session]", shop, msg);
    return { ok: false, error: "session_error" };
  }
}
