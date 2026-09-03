import type { Config } from "@react-router/dev/config";

// React Router's action CSRF check compares the browser's `Origin` header
// against the request URL origin. In dev, the Shopify CLI proxy terminates
// TLS, so the server derives `request.url` as `http://<host>` while the
// browser sends `Origin: https://<host>` — a protocol mismatch that makes
// every `useFetcher`/form POST return 400 Bad Request. Allow the app's own
// host so actions pass the check (requests still require a valid Shopify
// session token via authenticate.admin).
const appUrl = process.env.SHOPIFY_APP_URL
  ? new URL(process.env.SHOPIFY_APP_URL)
  : null;

export default {
  allowedActionOrigins: appUrl ? [appUrl.host] : [],
} satisfies Config;