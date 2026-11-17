import { NextResponse } from "next/server";
import {
  demoWriteBlocked,
  isRecord,
  jsonNetworkFailure,
  jsonUpstreamFailure,
  postMerchant,
  requireMerchantSession,
} from "@/lib/merchant-route";
import { checkRateLimit, recordFailure } from "@/lib/rate-limit";

const INTENTS = [
  "toggle-app",
  "start-audit",
  "stop-audit",
  "set-admin-managed",
] as const;

type ControlIntent = (typeof INTENTS)[number];

function isControlIntent(value: unknown): value is ControlIntent {
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

  const limit = checkRateLimit(`store-control:${session!.email}`, Date.now(), {
    max: 20,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many requests. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }
  recordFailure(`store-control:${session!.email}`, Date.now(), {
    max: 20,
    windowMs: 60_000,
  });

  const { domain } = await ctx.params;
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || !isControlIntent(body.intent)) {
    return NextResponse.json({ ok: false, error: "Invalid intent." }, { status: 400 });
  }

  const shopDomain = decodeURIComponent(domain);
  const { res, data, error } = await postMerchant<Record<string, unknown>>(
    "/api/internal/store-control",
    {
      ...body,
      shopDomain,
      actorEmail: session!.email,
    },
  );
  if (error) return jsonNetworkFailure(error);
  if (!isRecord(data) || data.ok !== true) {
    return jsonUpstreamFailure(data, res!);
  }
  return NextResponse.json(data);
}