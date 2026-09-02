import { NextResponse } from "next/server";
import { requireAdmin, updateAdminProfile } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const { name, email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { success: false, error: "Email is required" },
        { status: 400 },
      );
    }

    const user = await updateAdminProfile(session.userId, { name, email });
    return NextResponse.json({ success: true, user });
  } catch (error) {
    const message = error instanceof Error ? error.message : "An error occurred";
    console.error("Update profile error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
