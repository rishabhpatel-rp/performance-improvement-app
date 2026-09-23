import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateDeferredScript, buildHiddenCss } from "../lib/script-generator";
import { readStringArray } from "../lib/store-sync.server";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "private, no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS,
  });
}

async function loadStorefrontScripts(shopDomain) {
  if (!shopDomain) {
    return json({ success: false, error: "Missing shop" }, 400);
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    include: {
      configs: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });

  const config = store?.configs?.[0];
  if (!store?.isActive || !config?.appEnabled) {
    return json({
      success: true,
      data: { auditScript: "", hiddenCss: "" },
    });
  }

  const deferArray = config.auditDeferArrayEnabled
    ? readStringArray(config.auditDeferArray)
    : [];
  const staticDefer = config.staticDeferDefaultsEnabled
    ? readStringArray(config.staticDeferDefaults)
    : [];
  const hideSelectors = config.auditHideSelectorsEnabled
    ? readStringArray(config.auditHideSelectors)
    : [];

  // Read first user delay scripts
  const firstUserDelayScripts = config.firstUserDelayScriptsEnabled
    ? readStringArray(config.firstUserDelayScripts)
    : [];

  const compiled = generateDeferredScript(deferArray, staticDefer, {
    firstUserDelayScripts,
    firstUserDelayMs: config.firstUserDelayMs ?? 12000,
    everyTimeDelayMs: config.everyTimeDelayMs ?? 6000,
    hideSelectors,
  });

  return json({
    success: true,
    data: {
      auditScript: compiled,
      hiddenCss: buildHiddenCss(hideSelectors),
    },
  });
}

async function handleProxy(request) {
  const auth = await authenticate.public.appProxy(request);
  const shopDomain =
    auth?.session?.shop || new URL(request.url).searchParams.get("shop");
  return loadStorefrontScripts(shopDomain);
}

export const loader = async ({ request }) => {
  try {
    return await handleProxy(request);
  } catch (error) {
    console.error("[api.storefront-scripts] loader failed:", error);
    return json({ success: false, error: "Failed to load scripts" });
  }
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  try {
    return await handleProxy(request);
  } catch (error) {
    console.error("[api.storefront-scripts] action failed:", error);
    return json({ success: false, error: "Failed to load scripts" });
  }
};
