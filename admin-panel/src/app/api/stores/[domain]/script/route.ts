import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { requireAdmin } from "@/lib/auth";

function envValue(name: string): string {
  const current = process.env[name];
  if (typeof current === "string" && current.length > 0) return current;
  try {
    const text = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
    const line = text.split("\n").find((row) => row.startsWith(`${name}=`));
    if (!line) return "";
    return line.slice(name.length + 1).trim().replace(/^"|"$/g, "");
  } catch {
    return "";
  }
}

export async function POST(
  request: Request,
  ctx: { params: Promise<{ domain: string }> },
) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const secret = envValue("INTERNAL_API_SECRET");
  const base = envValue("PAGEPULSE_INTERNAL_URL");
  if (!secret || !base) {
    return NextResponse.json(
      {
        ok: false,
        error: "Set INTERNAL_API_SECRET and PAGEPULSE_INTERNAL_URL on the admin panel.",
      },
      { status: 500 },
    );
  }

  const { domain } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const res = await fetch(`${base.replace(/\/$/, "")}/api/internal/storefront-lists`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pagepulse-internal": secret,
    },
    body: JSON.stringify({ ...body, shopDomain: decodeURIComponent(domain) }),
  });
  const payload = await res.json().catch(() => ({
    ok: false,
    error: "Merchant app did not return JSON",
  }));
  return NextResponse.json(payload, { status: res.status });
}
