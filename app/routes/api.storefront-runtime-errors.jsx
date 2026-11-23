import { authenticate } from "../shopify.server";
import { json } from "../lib/internal-request.ts";
import { resolveVerifiedProxyShop, verifyAppProxyShop } from "../lib/proxy-shop";
import { getEnv } from "../lib/env.server.ts";
import { recordStorefrontRuntimeErrors } from "../lib/storefront-runtime-errors.server.ts";

export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ ok: false }, 405);
  }
  try {
    const shopDomain =
      verifyAppProxyShop(request, getEnv().SHOPIFY_API_SECRET) ??
      resolveVerifiedProxyShop(await authenticate.public.appProxy(request));

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ ok: false }, 400);
    }
    const errors = Array.isArray(body?.errors) ? body.errors : [];
    if (shopDomain && errors.length) {
      await recordStorefrontRuntimeErrors(shopDomain, errors);
    }
    return json({ ok: true });
  } catch {
    return json({ ok: false }, 400);
  }
}
