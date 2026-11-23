import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteConfig } from "../lib/metaobjects";
import { markStoreUninstalled, logActivity } from "../lib/store-sync.server";

import { logger } from "../lib/logger.ts";
export const action = async ({ request }) => {
  const { shop, session, topic, admin, payload } = await authenticate.webhook(request);

  logger.info(`Received ${topic} webhook for ${shop}`);

  // Mark the store as uninstalled in our database. This must run even when
  // session/admin are undefined (the app has already lost API access by the
  // time this webhook fires), so it only relies on the webhook payload/shop.
  try {
    await markStoreUninstalled(shop);
    await logActivity(shop, "uninstalled", `App uninstalled from ${shop}`, {
      shopDomain: shop,
      shopName: payload?.name || undefined,
      planName: payload?.plan_name || undefined,
    });
    logger.info(`[uninstalled] Store marked as inactive: ${shop}`);
  } catch (err) {
    logger.error(
      `[uninstalled] Failed to update store record for ${shop}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Webhooks can fire more than once, so the session may already be deleted.
  if (session && admin) {
    try {
      await deleteConfig(admin);
      logger.info(`Cleaned up config metaobject for ${shop}`);
    } catch (err) {
      // Metaobjects may already be gone or the shop's access may have been
      // revoked by uninstall; don't block session cleanup on this.
      logger.info(`Metaobject cleanup skipped for ${shop}: ${err.message}`);
    }

    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
