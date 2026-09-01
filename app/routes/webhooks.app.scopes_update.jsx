import { authenticate } from "../shopify.server";
import db from "../db.server";
import { updateStoreScope, logActivity } from "../lib/store-sync.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const current = payload.current;

  if (session) {
    const previousScope = session.scope || "unknown";

    // Existing behavior: update session scope
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: current.toString(),
      },
    });

    // Update the store record + log the scope change for the admin panel
    try {
      await updateStoreScope(shop, current.toString());
      await logActivity(shop, "scope_updated", `Access scopes updated`, {
        previousScope,
        newScope: current.toString(),
      });
    } catch (err) {
      console.error(
        `[scopes_update] Failed to update store scope for ${shop}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return new Response();
};
