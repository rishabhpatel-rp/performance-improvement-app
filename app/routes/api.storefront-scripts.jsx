import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { generateDeferredScript } from "../lib/script-generator";

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
    include: { performanceScript: true },
  });

  if (!store?.performanceScript) {
    return json({ success: false, error: "No scripts configured" });
  }

  const { auditScript, deferScript, hiddenCss } = store.performanceScript;
  const compiled = generateDeferredScript(auditScript, deferScript);

  return json({
    success: true,
    data: {
      auditScript: compiled,
      hiddenCss: hiddenCss || "",
    },
  });
}

export const loader = async ({ request }) => {
  await authenticate.public.appProxy(request);
  const shopDomain = new URL(request.url).searchParams.get("shop");
  return loadStorefrontScripts(shopDomain);
};

export const action = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  await authenticate.public.appProxy(request);
  const shopDomain = new URL(request.url).searchParams.get("shop");
  return loadStorefrontScripts(shopDomain);
};
