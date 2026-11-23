import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/auth";
import { archiveStoreThenErase } from "@/lib/store-archive";
import { checkRateLimit, recordFailure } from "@/lib/rate-limit";
import { getDemoMode } from "@/lib/demo-mode";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function POST(request: Request, ctx: { params: Promise<{ domain: string }> }) {
  const session = await requireRole("admin");
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  if ((await getDemoMode()) === "on") {
    return NextResponse.json(
      { ok: false, error: "Disabled while demo mode is on." },
      { status: 403 },
    );
  }

  const rateKey = `store-purge:${session.email}`;
  const limit = await checkRateLimit(rateKey, Date.now(), { max: 5, windowMs: 15 * 60 * 1000 });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many attempts. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }

  const shopDomain = decodeURIComponent((await ctx.params).domain);
  const body: unknown = await request.json().catch(() => null);
  if (!isRecord(body) || typeof body.password !== "string" || !body.password) {
    return NextResponse.json({ ok: false, error: "Admin password is required." }, { status: 400 });
  }
  if (body.confirm !== true) {
    return NextResponse.json({ ok: false, error: "Confirmation required." }, { status: 400 });
  }

  const user = await prisma.adminUser.findUnique({
    where: { id: session.userId },
    select: { passwordHash: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const passwordOk = await bcrypt.compare(body.password, user.passwordHash);
  if (!passwordOk) {
    await recordFailure(rateKey, Date.now(), { max: 5, windowMs: 15 * 60 * 1000 });
    return NextResponse.json({ ok: false, error: "Incorrect password." }, { status: 403 });
  }

  try {
    const result = await archiveStoreThenErase(shopDomain, {
      reason: "admin_manual",
      actorEmail: session.email,
    });
    if (result.skipped) {
      return NextResponse.json(
        {
          ok: false,
          error:
            result.reason === "active"
              ? "Cannot purge an active install. Uninstall first, or wait for inactive status."
              : "Store not found in live database.",
        },
        { status: result.reason === "missing" ? 404 : 409 },
      );
    }
    return NextResponse.json({ ok: true, archiveId: result.archiveId });
  } catch (err) {
    console.error("[store-purge]", err);
    return NextResponse.json(
      { ok: false, error: "Archive/purge failed. Live data was not removed." },
      { status: 500 },
    );
  }
}
