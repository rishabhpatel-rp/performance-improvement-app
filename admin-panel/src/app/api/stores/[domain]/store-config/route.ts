import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { callPagePulseStoreConfigApi } from "@/lib/pagepulse-app";
import { getDemoMode } from "@/lib/demo-mode";
import { getDummyStoreByDomain } from "@/lib/dummy-data";
import { prisma } from "@/lib/prisma";

type RouteContext = { params: Promise<{ domain: string }> };

async function resolveShopDomain(domainParam: string): Promise<string | null> {
  const domain = decodeURIComponent(domainParam).trim();
  const demoMode = await getDemoMode();
  if (demoMode === "on" && getDummyStoreByDomain(domain)) {
    return null;
  }
  const store = await prisma.store.findUnique({
    where: { shopDomain: domain },
    select: { shopDomain: true, isActive: true },
  });
  if (!store?.isActive) return null;
  return store.shopDomain;
}

export async function POST(request: Request, context: RouteContext) {
  const admin = await requireRole("admin");
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { domain } = await context.params;
  const shopDomain = await resolveShopDomain(domain);
  if (!shopDomain) {
    return NextResponse.json(
      { ok: false, error: "Store not found or demo store" },
      { status: 404 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const intent = body.intent;
  if (intent !== "save-audit-arrays" && intent !== "toggle-audit-field") {
    return NextResponse.json({ ok: false, error: "Unknown intent" }, { status: 400 });
  }

  const { ok, status, body: result } = await callPagePulseStoreConfigApi(
    shopDomain,
    body,
  );

  return NextResponse.json(result, { status: ok ? 200 : status });
}
