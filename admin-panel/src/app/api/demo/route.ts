import { NextResponse } from "next/server";
import { setDemoMode } from "@/lib/demo-mode";

export async function POST(request: Request) {
  try {
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
