import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDemoMode } from "@/lib/demo-mode";
import {
  jsonNetworkFailure,
  originProblem,
  postMerchant,
  upstreamFailureDescriptor,
} from "@/lib/merchant-route";
import { consumeRateLimit } from "@/lib/rate-limit";
import { getCustomAuditRun } from "@/lib/custom-audit";
import { parseCustomAuditUrl } from "../../../../../shared/custom-audit-url.ts";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireRole("viewer");
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const runId = new URL(request.url).searchParams.get("runId")?.trim() ?? "";
  if (!runId) return NextResponse.json({ ok: false, error: "Missing runId." }, { status: 400 });

  const run = await getCustomAuditRun(runId);
  if (!run) return NextResponse.json({ ok: false, error: "Scan not found." }, { status: 404 });
  return NextResponse.json({ ok: true, run });
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

  const limit = await consumeRateLimit(`custom-audit:${session.email}`, {
    max: 3,
    windowMs: 600_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Too many scans. Retry in ${limit.retryAfterSeconds}s.` },
      { status: 429 },
    );
  }

  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const fields = body as { url?: unknown; password?: unknown };
  const parsed = parseCustomAuditUrl(fields.url);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  if (typeof fields.password === "string" && fields.password.length > 512) {
    return NextResponse.json({ ok: false, error: "That password is too long." }, { status: 400 });
  }

  const password =
    typeof fields.password === "string" && fields.password ? fields.password : undefined;
  const { res, data, error } = await postMerchant("/api/internal/custom-audit", {
    url: parsed.url,
    password,
    actorEmail: session.email,
  });
  if (error) return jsonNetworkFailure(error);
  if (!res!.ok || !data || data.ok !== true) {
    const descriptor = upstreamFailureDescriptor(data, res!);
    return NextResponse.json(descriptor.body, { status: descriptor.status });
  }
  return NextResponse.json(data);
}
