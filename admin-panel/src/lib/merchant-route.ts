import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getDemoMode } from "@/lib/demo-mode";
import { callMerchantInternal } from "@/lib/internal-api";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";
import { parseShopDomain } from "@/lib/shop-domain";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RouteSession = NonNullable<Awaited<ReturnType<typeof requireRole>>>;

function fail(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
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

/**
 * Maps a failed merchant response onto the browser. A merchant 401/403 means
 * the shared secret is wrong, not that the admin's own session expired, so it
 * is reported as a bridge error (502) rather than passed through.
 */
export function upstreamFailureDescriptor(data: unknown, res: Response) {
  if (res.status === 401 || res.status === 403) {
    return {
      status: 502,
      body: {
        ok: false,
        error:
          "Merchant app rejected the internal secret. Make sure INTERNAL_API_SECRET matches in both apps.",
      },
    };
  }
  return {
    status: res.status >= 400 ? res.status : 502,
    body: {
      ...(isRecord(data) ? (data as Record<string, unknown>) : {}),
      ok: false,
      error: merchantError(data, res),
    },
  };
}

export function jsonUpstreamFailure(data: unknown, res: Response) {
  const { status, body } = upstreamFailureDescriptor(data, res);
  return NextResponse.json(body, { status });
}

export function jsonNetworkFailure(message: string) {
  return fail(message, 502);
}

type Shop = { id: string; isActive: boolean };

export type MerchantWriteOptions = {
  /** Merchant internal route, e.g. `/api/internal/store-control`. */
  path: string;
  /** Rate-limit bucket name and per-minute budget. */
  limit: { name: string; max: number };
  /** Returns an error message for an invalid body, or null when it is fine. */
  validate: (body: Record<string, unknown>) => string | null;
  /** Writes require an installed shop when true. */
  requireActiveStore?: boolean;
};

/**
 * Shared pipeline for every admin write that is forwarded to the merchant app:
 * admin role -> demo guard -> rate limit -> domain/body validation -> store
 * check -> forward with the acting admin's email. The merchant app writes the
 * activity-log row (with that actor), so the BFF does not log a second one.
 */
export type MerchantWriteGate = {
  authenticated: boolean;
  demoMode: boolean;
  rateAllowed: boolean;
  retryAfterSeconds: number;
  shopDomain: string | null;
  bodyIsRecord: boolean;
  invalid: string | null;
  storeActive: boolean;
};

export function merchantWriteProblem(
  gate: MerchantWriteGate,
): { error: string; status: number } | null {
  if (!gate.authenticated) return { error: "Unauthorized", status: 401 };
  if (gate.demoMode) return { error: "Demo mode: writes disabled.", status: 403 };
  if (!gate.rateAllowed) {
    return { error: `Too many requests. Retry in ${gate.retryAfterSeconds}s.`, status: 429 };
  }
  if (!gate.shopDomain) return { error: "Invalid shop domain.", status: 400 };
  if (!gate.bodyIsRecord) return { error: "Invalid JSON body.", status: 400 };
  if (gate.invalid) return { error: gate.invalid, status: 400 };
  if (!gate.storeActive) return { error: "Store not found or inactive", status: 404 };
  return null;
}

function isLocalDevHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname) ||
    /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  );
}

/** True when the browser Origin matches this request (Host or URL), including
 *  local-dev localhost ↔ 127.0.0.1 ↔ LAN IP on the same port. */
export function originMatchesRequest(origin: string, request: Request): boolean {
  try {
    const actual = new URL(origin);
    const expected = new URL(request.url);
    if (actual.origin === expected.origin) return true;
    const hostHeader = request.headers.get("host");
    if (hostHeader && actual.host === hostHeader) return true;
    if (
      process.env.NODE_ENV !== "production" &&
      actual.port === expected.port &&
      isLocalDevHost(actual.hostname) &&
      isLocalDevHost(expected.hostname)
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Defence-in-depth CSRF check: browser writes must come from this origin.
 *  Non-browser clients (no Origin / Sec-Fetch-Site) are allowed — the session
 *  cookie is still required and is SameSite=Lax. */
export function originProblem(request: Request): { error: string; status: number } | null {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const origin = request.headers.get("origin");
  if (origin) {
    if (!originMatchesRequest(origin, request)) {
      try {
        new URL(origin);
      } catch {
        return { error: "Invalid Origin header.", status: 400 };
      }
      return { error: "Cross-origin request rejected.", status: 403 };
    }
  }
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    // Same browser host as Host header (e.g. LAN IP) is fine even when the
    // UA reports cross-site due to localhost vs IP quirks in dev.
    if (origin && originMatchesRequest(origin, request)) return null;
    return { error: "Cross-site request rejected.", status: 403 };
  }
  return null;
}

export async function forwardMerchantWrite(
  request: Request,
  ctx: { params: Promise<{ domain: string }> },
  options: MerchantWriteOptions,
) {
  const originIssue = originProblem(request);
  if (originIssue) return fail(originIssue.error, originIssue.status);
  const session: RouteSession | null = await requireRole("admin");
  const demoMode = (await getDemoMode()) === "on";
  const limit = session
    ? await consumeRateLimit(`${options.limit.name}:${session.email}`, {
        max: options.limit.max,
        windowMs: 60_000,
      })
    : { allowed: false, retryAfterSeconds: 0 };
  const parsedDomain = parseShopDomain((await ctx.params).domain);
  const body: unknown = await request.json().catch(() => null);
  const invalid = isRecord(body) ? options.validate(body) : null;
  let storeActive = true;
  if (
    session &&
    !demoMode &&
    limit.allowed &&
    parsedDomain &&
    isRecord(body) &&
    !invalid &&
    options.requireActiveStore
  ) {
    const store: Shop | null = await prisma.store.findUnique({
      where: { shopDomain: parsedDomain },
      select: { id: true, isActive: true },
    });
    storeActive = Boolean(store?.isActive);
  }
  const problem = merchantWriteProblem({
    authenticated: Boolean(session),
    demoMode,
    rateAllowed: limit.allowed,
    retryAfterSeconds: limit.retryAfterSeconds,
    shopDomain: parsedDomain,
    bodyIsRecord: isRecord(body),
    invalid,
    storeActive,
  });
  if (problem) return fail(problem.error, problem.status);
  if (!session || !parsedDomain || !isRecord(body)) return fail("Unauthorized", 401);
  const shopDomain = parsedDomain;
  const bodyRecord: Record<string, unknown> = body;

  const { res, data, error } = await postMerchant<Record<string, unknown>>(options.path, {
    ...bodyRecord,
    shopDomain,
    actorEmail: session.email,
  });
  if (error) return jsonNetworkFailure(error);
  if (!res!.ok || !isRecord(data) || data.ok !== true) {
    return jsonUpstreamFailure(data, res!);
  }
  return NextResponse.json(data);
}

/** Read-only counterpart used by the `/state` poller (viewer role is enough). */
export async function readMerchantState(ctx: { params: Promise<{ domain: string }> }) {
  const session = await requireRole("viewer");
  if (!session) return fail("Unauthorized", 401);

  const shopDomain = parseShopDomain((await ctx.params).domain);
  if (!shopDomain) return fail("Invalid shop domain.", 400);

  const { res, data, error } = await postMerchant("/api/internal/storefront-state", { shopDomain });
  if (error) return jsonNetworkFailure(error);
  if (!isRecord(data) || data.ok !== true) {
    return jsonUpstreamFailure(data, res!);
  }
  return NextResponse.json(data);
}
