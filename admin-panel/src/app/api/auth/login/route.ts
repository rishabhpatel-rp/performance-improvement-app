import { NextResponse } from "next/server";
import { loginAdmin } from "@/lib/auth";
import {
  checkBoth,
  recordFailureBoth,
  loginKey,
  resetAttempts,
} from "@/lib/rate-limit";

/**
 * The rate-limit IP must NOT be taken from the client-controlled leftmost
 * `X-Forwarded-For` entry — `curl -H 'x-forwarded-for: 1.2.3.4'` would hand
 * every request a fresh bucket. Prefer the platform-provided header that the
 * trusted proxy sets; fall back to the LAST hop in the chain, which is the one
 * closest to us and is what an appending proxy actually controls.
 */
function clientIp(request: Request): string {
  const platform = request.headers.get("cf-connecting-ip");
  if (platform) return platform.trim();
  const realIp = request.headers.get("x-real-ip");
  if (realIp) return realIp.trim();
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded.split(",").map((h) => h.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return "unknown";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 },
      );
    }

    // Brute-force protection (audit Task 9). See lib/rate-limit.ts.
    const key = loginKey(email, clientIp(request));
    const limit = checkBoth(key, clientIp(request));
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const user = await loginAdmin(email, password);

    if (!user) {
      recordFailureBoth(key, clientIp(request));
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 },
      );
    }

    resetAttempts(key);
    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, error: "An error occurred" },
      { status: 500 },
    );
  }
}
