import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { rebuildPerformanceScript } from "../lib/performance-script.server";

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
    const auth = await authenticate.public.appProxy(request);
    const shopDomain =
      auth?.session?.shop || new URL(request.url).searchParams.get("shop");
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
