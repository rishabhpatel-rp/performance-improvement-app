import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { isStep2OfferPopupEnabled } from "../lib/global-settings.server.ts";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const reply = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

export async function action({ request }) {
  const { session } = await authenticate.admin(request);

  if (!(await isStep2OfferPopupEnabled())) {
    return reply({ ok: false, error: "This offer is not available." }, 403);
  }

  const formData = await request.formData();
  const email = String(formData.get("email") || "").trim();
  if (!EMAIL_PATTERN.test(email) || email.length > 254) {
    return reply({ ok: false, error: "Enter a valid email address." }, 400);
  }

  const since = new Date(Date.now() - 60_000);
  const recent = await prisma.popupLead.count({
    where: { shopDomain: session.shop, createdAt: { gte: since } },
  });
  if (recent >= 5) {
    return reply({ ok: false, error: "Too many requests. Try again shortly." }, 429);
  }

  await prisma.popupLead.create({ data: { shopDomain: session.shop, email } });
  return reply({ ok: true });
}
