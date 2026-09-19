import { authenticate } from "../shopify.server";
import { eraseShopData } from "../lib/store-sync.server";

function normalizeTopic(topic) {
  return String(topic || "")
    .toLowerCase()
    .replace(/_/g, "/");
}

/**
 * Mandatory App Store compliance webhooks.
 * authenticate.webhook verifies the Shopify HMAC header and throws 401
 * when the signature is missing or invalid.
 */
export const action = async ({ request }) => {
  const { topic, shop, payload } = await authenticate.webhook(request);
  const normalized = normalizeTopic(topic);
  const shopDomain = shop || payload?.shop_domain;

  console.log(`Received ${topic} webhook for ${shopDomain}`);

  switch (normalized) {
    case "customers/data_request":
      // This app does not store Shopify customer or order records.
      // Acknowledge so merchants can complete the data-request flow.
      console.log(
        `[customers/data_request] No customer data stored for ${shopDomain}`,
        payload?.customer?.id || "",
      );
      break;

    case "customers/redact":
      // No customer PII is persisted; nothing to delete.
      console.log(
        `[customers/redact] No customer data to redact for ${shopDomain}`,
        payload?.customer?.id || "",
      );
      break;

    case "shop/redact":
      try {
        await eraseShopData(shopDomain);
        console.log(`[shop/redact] Erased shop data for ${shopDomain}`);
      } catch (err) {
        console.error(
          `[shop/redact] Failed to erase data for ${shopDomain}:`,
          err instanceof Error ? err.message : err,
        );
      }
      break;

    default:
      console.log(`[compliance] Unhandled topic ${topic}`);
  }

  return new Response();
};
