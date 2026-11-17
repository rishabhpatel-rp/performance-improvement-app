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

const INTENTS = ["save-lists", "toggle", "script-token-action", "resync"] as const;
type ScriptIntent = (typeof INTENTS)[number];

function isScriptIntent(value: unknown): value is ScriptIntent {
  return typeof value === "string" && (INTENTS as readonly string[]).includes(value);
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ domain: string }> },
) {
  const { session, unauthorized } = await requireMerchantSession("admin");
  if (unauthorized) return unauthorized;

  const demoBlock = await demoWriteBlocked();
  if (demoBlock) return demoBlock;

  const writeLimit = checkRateLimit(`script-write:${session!.email}`, Date.now(), {
    max: 30,
    windowMs: 60_000,
  });
  if (!writeLimit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many writes. Retry in ${writeLimit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }
  recordFailure(`script-write:${session!.email}`, Date.now(), {
    max: 30,
    windowMs: 60_000,
  });

  const { domain } = await ctx.params;
  if (!domain) {
    return NextResponse.json({ ok: false, error: "Missing domain" }, { status: 400 });
  }

  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !isScriptIntent(body.intent)) {
    const intent = isRecord(body) ? body.intent : undefined;
    return NextResponse.json(
      { ok: false, error: `Unsupported intent: ${String(intent ?? "")}` },
      { status: 400 },
    );
  }

  const shopDomain = decodeURIComponent(domain);
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { isActive: true, id: true },
  });
  if (!store?.isActive) {
    return NextResponse.json({ ok: false, error: "Store not found or inactive" }, { status: 404 });
  }

  const { res, data: raw, error } = await postMerchant<Record<string, unknown>>(
    "/api/internal/storefront-lists",
    { ...body, shopDomain },
  );
  if (error) return jsonNetworkFailure(error);
  if (!res!.ok || !isRecord(raw) || raw.ok !== true) {
    const errMsg = isRecord(raw) && typeof raw.error === "string" ? raw.error : merchantError(raw, res!);
    return NextResponse.json({ ok: false, error: errMsg }, { status: res!.status || 502 });
  }

  const metafieldStatus =
    typeof raw.metafieldStatus === "string" ? raw.metafieldStatus : null;
  const metadata: Prisma.InputJsonValue = {
    metafieldStatus,
    scope: typeof body.scope === "string" ? body.scope : null,
    actor: session!.email,
  };
  try {
    await prisma.storeActivity.create({
      data: {
        storeId: store.id,
        eventType: "config_changed",
        description: `storefront lists ${body.intent} on ${shopDomain}`,
        metadata,
      },
    });
  } catch (logError) {
    console.error("[script] activity log failed", logError);
  }

  return NextResponse.json(raw);
}