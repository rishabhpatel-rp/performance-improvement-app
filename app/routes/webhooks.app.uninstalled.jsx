import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteConfig } from "../lib/metaobjects";
import { markStoreUninstalled, logActivity } from "../lib/store-sync.server";

export const action = async ({ request }) => {
  const { shop, session, topic, admin, payload } =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

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
    console.log(`[uninstalled] Store marked as inactive: ${shop}`);
  } catch (err) {
    console.error(
      `[uninstalled] Failed to update store record for ${shop}:`,
      err instanceof Error ? err.message : err,
    );
  }

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session && admin) {
    try {
      await deleteConfig(admin);
      console.log(`Cleaned up config metaobject for ${shop}`);
    } catch (err) {
      // Metaobjects may already be gone or the shop's access may have been
      // revoked by uninstall; don't block session cleanup on this.
      console.log(`Metaobject cleanup skipped for ${shop}: ${err.message}`);
    }

    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
