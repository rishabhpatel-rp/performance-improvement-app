import { NextResponse } from "next/server";
import { loginAdmin } from "@/lib/auth";
import {
  checkRateLimit,
  loginKey,
  recordFailure,
  resetAttempts,
} from "@/lib/rate-limit";

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 },
      );
    }

    // Brute-force protection (audit Task 9). See lib/rate-limit.ts.
    const key = loginKey(email, clientIp(request));
    const limit = checkRateLimit(key);
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "Too many attempts. Try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
      );
    }

    const user = await loginAdmin(email, password);

    if (!user) {
      recordFailure(key);
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
