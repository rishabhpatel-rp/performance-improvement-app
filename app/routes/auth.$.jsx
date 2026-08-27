import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { ensureGlobalConfig } from "../lib/metaobjects";

export const loader = async ({ request }) => {
  await authenticate.admin(request);

  // First admin load after OAuth: create the config metaobject if it
  // doesn't exist yet so onboarding state is ready for app._index.
  await ensureGlobalConfig(request);

  return null;
};

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
