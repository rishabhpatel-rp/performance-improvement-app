import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDemoMode } from "@/lib/demo-mode";
import { callMerchantInternal } from "@/lib/internal-api";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type AdminSession = NonNullable<Awaited<ReturnType<typeof requireRole>>>;

export async function requireMerchantSession(role: "admin" | "viewer" = "admin") {
  const session = await requireRole(role);
  if (!session) {
    return {
      session: null as AdminSession | null,
      unauthorized: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  return { session, unauthorized: null };
}

export async function demoWriteBlocked() {
  if ((await getDemoMode()) === "on") {
    return NextResponse.json({ ok: false, error: "Demo mode: writes disabled." }, { status: 403 });
  }
  return null;
}

export function merchantError(data: unknown, res: Response): string {
  if (isRecord(data) && typeof data.error === "string") return data.error;
  return `Upstream error (${res.status})`;
}

export async function postMerchant<T extends Record<string, unknown>>(
  path: string,
  body: Record<string, unknown>,
) {
  try {
    const { res, data } = await callMerchantInternal<T>(path, body);
    return { res, data, error: null as string | null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Upstream request failed";
    return { res: null, data: null, error: message };
  }
}

export function jsonUpstreamFailure(data: unknown, res: Response) {
  return NextResponse.json(
    { ok: false, error: merchantError(data, res), ...(isRecord(data) ? data : {}) },
    { status: res.status || 502 },
  );
}

export function jsonNetworkFailure(message: string) {
  return NextResponse.json({ ok: false, error: message }, { status: 502 });
}