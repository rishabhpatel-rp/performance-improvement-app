import { NextResponse } from "next/server";
import { setDemoMode } from "@/lib/demo-mode";
import { requireAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    // Previously this only set a UI cookie with no auth check at all — any
    // unauthenticated caller could flip demo mode for every viewer of the
    // dashboard (REQUIREMENTS_AND_PLANS.md R1 issue #7).
    const session = await requireAdmin();
    if (!session) {
      return NextResponse.json(
        { success: false, error: "Not authenticated" },
        { status: 401 },
      );
    }

    const { enabled } = await request.json();

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "'enabled' must be a boolean" },
        { status: 400 },
      );
    }

    await setDemoMode(enabled ? "on" : "off");

    return NextResponse.json({ success: true, demoMode: enabled ? "on" : "off" });
  } catch (error) {
    console.error("Demo mode toggle error:", error);
    return NextResponse.json(
      { success: false, error: "An error occurred" },
      { status: 500 },
    );
  }
}
