import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  demoWriteBlocked,
  isRecord,
  jsonNetworkFailure,
  merchantError,
  postMerchant,
  requireMerchantSession,
} from "@/lib/merchant-route";
import { checkRateLimit, recordFailure } from "@/lib/rate-limit";

export async function POST(
  request: Request,
  ctx: { params: Promise<{ domain: string }> },
) {
  const { session, unauthorized } = await requireMerchantSession("admin");
  if (unauthorized) return unauthorized;

  const demoBlock = await demoWriteBlocked();
  if (demoBlock) return demoBlock;

  const limit = checkRateLimit(`admin-head:${session!.email}`, Date.now(), {
    max: 15,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many saves. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }
  recordFailure(`admin-head:${session!.email}`, Date.now(), {
    max: 15,
    windowMs: 60_000,
  });

  const shopDomain = decodeURIComponent((await ctx.params).domain);
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body)) {
    return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 });
  }

  const intent = body.intent === "clear" ? "clear" : "save";
  const html = intent === "clear" ? "" : body.html;
  if (intent === "save" && typeof html !== "string") {
    return NextResponse.json({ ok: false, error: "html must be a string." }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, isActive: true },
  });
  if (!store?.isActive) {
    return NextResponse.json({ ok: false, error: "Store not found or inactive" }, { status: 404 });
  }

  const { res, data: raw, error } = await postMerchant<Record<string, unknown>>(
    "/api/internal/admin-head-html",
    {
      shopDomain,
      intent,
      html,
      actorEmail: session!.email,
    },
  );
  if (error) return jsonNetworkFailure(error);
  if (!res!.ok || !isRecord(raw) || raw.ok !== true) {
    const errMsg =
      isRecord(raw) && typeof raw.error === "string"
        ? raw.error
        : res!.status === 500 && !isRecord(raw)
          ? `Merchant app error (500). Run npx prisma generate and restart shopify app dev, then: node scripts/sync-admin-merchant-url.mjs`
          : merchantError(raw, res!);
    return NextResponse.json({ ok: false, error: errMsg }, { status: res!.status || 502 });
  }

  const metadata: Prisma.InputJsonValue = {
    intent,
    actor: session!.email,
    metafieldStatus: typeof raw.metafieldStatus === "string" ? raw.metafieldStatus : null,
  };
  try {
    await prisma.storeActivity.create({
      data: {
        storeId: store.id,
        eventType: "config_changed",
        description: `admin head HTML ${intent} on ${shopDomain}`,
        metadata,
      },
    });
  } catch (logError) {
    console.error("[admin-head] activity log failed", logError);
  }

  return NextResponse.json(raw);
}