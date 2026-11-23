import {
  json,
  parseInternalRequest,
  readActorEmail,
  readInternalSecret,
} from "../lib/internal-request.ts";
import { saveAdminHeadHtml } from "../lib/admin-head-html.server.ts";

/** Prisma client generated before the `adminHeadHtml` column existed. */
function isStalePrismaClient(message) {
  return message.includes("adminHeadHtml") || message.includes("Unknown argument");
}

export const action = async ({ request }) => {
  const parsed = await parseInternalRequest(request, readInternalSecret());
  if (!parsed.ok) return json(parsed.rejection.body, parsed.rejection.status);
  const { body, shopDomain } = parsed;

  const intent = String(body.intent || "save");
  if (intent !== "save" && intent !== "clear") {
    return json({ ok: false, error: "Invalid intent." }, 400);
  }
  const html = intent === "clear" ? "" : body.html;
  if (typeof html !== "string") {
    return json({ ok: false, error: "html must be a string." }, 400);
  }

  try {
    const result = await saveAdminHeadHtml(shopDomain, html, readActorEmail(body));
    return json(result, result.ok ? 200 : 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Save failed.";
    return json(
      {
        ok: false,
        error: isStalePrismaClient(message)
          ? "Merchant app Prisma client is out of date. Run: npx prisma generate (repo root) and restart shopify app dev."
          : message,
      },
      500,
    );
  }
};
