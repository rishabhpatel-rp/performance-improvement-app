import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDemoMode } from "@/lib/demo-mode";
import { originProblem } from "@/lib/merchant-route";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getStep2OfferPopupEnabled, setStep2OfferPopupEnabled } from "@/lib/global-settings";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await requireRole("viewer");
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({ ok: true, enabled: await getStep2OfferPopupEnabled() });
}

export async function POST(request: Request) {
  const originIssue = originProblem(request);
  if (originIssue) {
    return NextResponse.json(
      { ok: false, error: originIssue.error },
      { status: originIssue.status },
    );
  }

  const session = await requireRole("admin");
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  if ((await getDemoMode()) === "on") {
    return NextResponse.json({ ok: false, error: "Demo mode: writes disabled." }, { status: 403 });
  }

  const limit = await consumeRateLimit(`popup-toggle:${session.email}`, {
    max: 30,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many requests. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (
    !body ||
    typeof body !== "object" ||
    typeof (body as { enabled?: unknown }).enabled !== "boolean"
  ) {
    return NextResponse.json(
      { ok: false, error: "Expected a boolean 'enabled' value." },
      { status: 400 },
    );
  }

  const enabled = (body as { enabled: boolean }).enabled;
  await setStep2OfferPopupEnabled(enabled, session.email);
  return NextResponse.json({ ok: true, enabled });
}
