import { internalAuthOk } from "../lib/scan-summary-scope.js";
import { readInternalSecret } from "../lib/internal-storefront-route.js";
import { saveAdminHeadHtml } from "../lib/admin-head-html.server.js";

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

  const shopDomain = String(body?.shopDomain || "").trim();
  if (!shopDomain) {
    return json({ ok: false, error: "Missing shopDomain." }, 400);
  }

  const intent = String(body?.intent || "save");
  if (intent !== "save" && intent !== "clear") {
    return json({ ok: false, error: "Invalid intent." }, 400);
  }

  const html =
    intent === "clear"
      ? ""
      : typeof body.html === "string"
        ? body.html
        : null;
  if (html === null) {
    return json({ ok: false, error: "html must be a string." }, 400);
  }

  try {
    const result = await saveAdminHeadHtml(
      shopDomain,
      html,
      typeof body.actorEmail === "string" ? body.actorEmail : null,
    );
    if (!result.ok) {
      return json(result, 400);
    }
    return json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed.";
  const prismaStale =
      message.includes("adminHeadHtml") ||
      message.includes("Unknown argument");
    return json(
      {
        ok: false,
        error: prismaStale
          ? "Merchant app Prisma client is out of date. Run: npx prisma generate (repo root) and restart shopify app dev."
          : message,
      },
      500,
    );
  }
};