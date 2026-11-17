import { internalAuthOk } from "../lib/scan-summary-scope.js";
import { readInternalSecret } from "../lib/internal-storefront-route.js";
import { loadStoreStep2Snapshot } from "../lib/step2-config.server";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }
  const secret = readInternalSecret();
  if (!internalAuthOk(request.headers.get("x-pagepulse-internal"), secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const shopDomain = String(body?.shopDomain || "");
  if (!shopDomain) {
    return json({ ok: false, error: "Missing shopDomain." }, 400);
  }

  const snapshot = await loadStoreStep2Snapshot(shopDomain);
  if (!snapshot) {
    return json({ ok: false, error: "Store config not found." }, 404);
  }

  return json({ ok: true, ...snapshot });
};
