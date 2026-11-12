import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDemoMode } from "@/lib/demo-mode";

const INTENTS = ["save-lists", "toggle", "script-token-action"] as const;
type ScriptIntent = (typeof INTENTS)[number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScriptIntent(value: unknown): value is ScriptIntent {
  return typeof value === "string" && (INTENTS as readonly string[]).includes(value);
}

type UpstreamResult = {
  ok: boolean;
  error?: string;
  metafieldStatus?: string;
};

function readUpstream(value: unknown): UpstreamResult {
  if (!isRecord(value)) return { ok: false, error: "No JSON" };
  return {
    ok: value.ok === true,
    error: typeof value.error === "string" ? value.error : undefined,
    metafieldStatus:
      typeof value.metafieldStatus === "string" ? value.metafieldStatus : undefined,
  };
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ domain: string }> },
) {
  const session = await requireRole("admin");
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const demoMode = await getDemoMode();
  if (demoMode === "on") {
    return NextResponse.json({ ok: false, error: "Demo mode: writes disabled." }, { status: 403 });
  }

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

  const decodedDomain = decodeURIComponent(domain);
  const store = await prisma.store.findUnique({
    where: { shopDomain: decodedDomain },
    select: { isActive: true, id: true },
  });
  if (!store?.isActive) {
    return NextResponse.json({ ok: false, error: "Store not found or inactive" }, { status: 404 });
  }

  const internalUrl = process.env.PAGEPULSE_INTERNAL_URL;
  if (!internalUrl) {
    return NextResponse.json(
      { ok: false, error: "PAGEPULSE_INTERNAL_URL is not configured." },
      { status: 500 },
    );
  }

  const safeBody = { ...body, shopDomain: decodedDomain };

  try {
    const res = await fetch(`${internalUrl}/api/internal/storefront-lists`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify(safeBody),
      cache: "no-store",
    });
    const data = readUpstream(await res.json().catch(() => null));
    if (!res.ok || !data.ok) {
      return NextResponse.json(
        { ok: false, error: data.error || `Upstream error (${res.status})` },
        { status: res.status || 502 },
      );
    }

    const metadata: Prisma.InputJsonValue = {
      metafieldStatus: data.metafieldStatus ?? null,
      scope: typeof body.scope === "string" ? body.scope : null,
      actor: session.email,
    };
    try {
      await prisma.storeActivity.create({
        data: {
          storeId: store.id,
          eventType: "config_changed",
          description: `storefront lists ${body.intent} on ${decodedDomain}`,
          metadata,
        },
      });
    } catch (logError) {
      console.error("[script] activity log failed", logError);
    }

    return NextResponse.json({ ok: true, metafieldStatus: data.metafieldStatus });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Upstream request failed" },
      { status: 502 },
    );
  }
}
