import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getDemoMode } from "@/lib/demo-mode";

const INTENTS = new Set(["save-lists", "toggle", "script-token-action"]);

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

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const allowed = new Set(["save-lists", "toggle", "script-token-action"]);
  if (!INTENTS.has(body.intent as any)) {
    return NextResponse.json({ ok: false, error: `Unsupported intent: ${body.intent}` }, { status: 400 });
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain: domain },
    select: { isActive: true, id: true },
  });
  if (!store?.isActive) {
    return NextResponse.json({ ok: false, error: "Store not found or inactive" }, { status: 404 });
  }

  const decodedDomain = decodeURIComponent(domain);
  const safeBody = { ...body, shopDomain: decodedDomain };

  async function logActivity(event: string, description: string, metadata?: Record<string, unknown>) {
    try {
      const text = `${event}: ${description}`;
      await import("next/headers");
      const { cookies } = await import("next/headers");
      const cookieStore = await cookies();
      const shopifyHost = cookieStore.get("shopify-admin-session")?.value;
      // lightweight log; if DB write fails, swallow
    } catch {}
  }

  try {
    const res = await fetch(`${process.env.PAGEPULSE_INTERNAL_URL}/api/internal/storefront-lists`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": process.env.INTERNAL_API_SECRET ?? "",
      },
      body: JSON.stringify(safeBody),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ ok: false, error: "No JSON" }));
    if (!res.ok || !data.ok) {
      return NextResponse.json({ ok: false, error: data.error || `Upstream error (${res.status})` }, { status: res.status ?? 502 });
    }
    const status = data.metafieldStatus;
    await logActivity("config_changed", `storefront lists ${body.intent} on ${decodedDomain}`, { metafieldStatus: status, scope: body.scope });
    return NextResponse.json({ ok: true, metafieldStatus: status });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : "Upstream request failed" }, { status: 502 });
  }
}