import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteAllScriptsForShop, deleteGlobalConfig } from "../lib/metaobjects";

export const action = async ({ request }) => {
  const { shop, session, topic, admin } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Webhook requests can trigger multiple times and after an app has already been uninstalled.
  // If this webhook already ran, the session may have been deleted previously.
  if (session && admin) {
    try {
      await deleteAllScriptsForShop(admin);
      await deleteGlobalConfig(admin);
      console.log(`Cleaned up scripts + config metaobjects for ${shop}`);
    } catch (err) {
      // Metaobjects may already be gone or the shop's access may have been
      // revoked by uninstall; don't block session cleanup on this.
      console.log(`Metaobject cleanup skipped for ${shop}: ${err.message}`);
    }

    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
