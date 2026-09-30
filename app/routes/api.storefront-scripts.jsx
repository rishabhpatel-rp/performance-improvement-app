import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { rebuildPerformanceScript } from "../lib/performance-script.server";
import {
  resolveVerifiedProxyShop,
  verifyAppProxyShop,
} from "../lib/proxy-shop";

// Storefront script endpoint, reached through the app proxy
// (/apps/performance-scripts) by the blocking <script src> in the theme app
// embed (extensions/script-injector/blocks/performance-loader.liquid).
//
// The script is obfuscated once, when its inputs change
// (rebuildPerformanceScript), and stored in PerformanceScript.deferScript.
// This route only reads it, so it must stay cheap: it blocks HTML parsing.

const OFF_SCRIPT = "/* pp:off */";

// Merchant edits reach browsers within max-age; the ETag makes revalidation
// a 304 once that expires.
const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=86400";

function scriptResponse(request, body, hash) {
  const headers = {
    "Content-Type": "application/javascript; charset=utf-8",
    "Cache-Control": CACHE_CONTROL,
  };
  if (hash) {
    const etag = `"${hash}"`;
    headers.ETag = etag;
    if (request.headers.get("If-None-Match") === etag) {
      return new Response(null, { status: 304, headers });
    }
  }
  return new Response(body, { status: 200, headers });
}

async function loadStorefrontScript(request, shopDomain) {
  if (!shopDomain) {
    return new Response("/* pp:missing-shop */", {
      status: 400,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      isActive: true,
      configs: {
        select: { appEnabled: true },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
      performanceScript: {
        select: { deferScript: true, scriptHash: true },
      },
    },
  });

  // Checked on every request (cheap) so a disabled/uninstalled store never
  // gets a stale script, even if a rebuild was missed.
  if (!store?.isActive || !store.configs[0]?.appEnabled) {
    return scriptResponse(request, OFF_SCRIPT, null);
  }

  let script = store.performanceScript?.deferScript || "";
  let hash = store.performanceScript?.scriptHash || null;

  // Existing installs / a failed earlier build: build once, then it is stored.
  if (!script) {
    const built = await rebuildPerformanceScript(shopDomain);
    script = built?.deferScript || "";
    hash = built?.scriptHash || null;
  }

  return scriptResponse(request, script || OFF_SCRIPT, script ? hash : null);
}

export const loader = async ({ request }) => {
  try {
    // Fast path (B3): verify the App Proxy signature in-process.
    //
    // This route runs on EVERY page load for EVERY shopper, and the
    // authenticated path below loads the offline session — which triggers a
    // Shopify OAuth token refresh roughly hourly on a shopper request path.
    // The route needs only `shop`; it never touches the session's admin or
    // storefront clients. `verifyAppProxyShop` therefore proves the same thing
    // without the session lookup.
    //
    // Anything the fast path declines (no signature, a signature Shopify
    // canonicalised differently, no configured secret) falls through to the
    // authenticated path, which is slower but authoritative. A canonicalisation
    // change at Shopify can therefore cost latency, never correctness.
    const shopDomain =
      // eslint-disable-next-line no-undef
      verifyAppProxyShop(request, process.env.SHOPIFY_API_SECRET) ??
      resolveVerifiedProxyShop(await authenticate.public.appProxy(request));

    // SECURITY: never fall back to an unsigned `shop` query param.
    // `shop` is only trusted once the App Proxy signature over it has been
    // verified — either by `verifyAppProxyShop` above or by
    // `authenticate.public.appProxy`. A falsy result means that check failed
    // (or there's no session), not that it's safe to trust whatever `shop` the
    // caller put in the URL. Trusting that param let anyone fetch any shop's
    // compiled storefront script by guessing/knowing its domain. An unverified
    // request gets the generic no-op script, never shop-specific data.
    if (!shopDomain) {
      return scriptResponse(request, OFF_SCRIPT, null);
    }

    return await loadStorefrontScript(request, shopDomain);
  } catch (error) {
    console.error("[api.storefront-scripts] loader failed:", error);
    // A failing script tag must never break the storefront; don't cache it.
    return new Response("/* pp:error */", {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store",
      },
    });
  }
};
