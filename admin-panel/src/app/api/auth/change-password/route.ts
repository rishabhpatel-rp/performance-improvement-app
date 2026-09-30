import { NextResponse } from "next/server";
import { requireAdmin, changeAdminPassword } from "@/lib/auth";

export async function POST(request: Request) {
  const session = await requireAdmin();
  if (!session) {
    return NextResponse.json(
      { success: false, error: "Not authenticated" },
      { status: 401 },
    );
  }

  try {
    const { currentPassword, newPassword } = await request.json();

    if (!currentPassword || !newPassword) {
      return NextResponse.json(
        { success: false, error: "Current and new password are required" },
        { status: 400 },
      );
    }
    if (newPassword.length < 8) {
      return NextResponse.json(
        { success: false, error: "New password must be at least 8 characters" },
        { status: 400 },
      );
    }

    await changeAdminPassword(session.userId, { currentPassword, newPassword });
    return NextResponse.json({ success: true });
  } catch (error) {
    // Only surface errors we raised deliberately. A blanket `error.message`
    // echo leaks Prisma/DB internals (e.g. "Unique constraint failed on the
    // fields: (email)") to an unauthenticated-ish client.
    const SAFE = new Set([
      "Current password is incorrect",
      "User not found",
      "Email is already in use by another account",
    ]);
    const message =
      error instanceof Error && SAFE.has(error.message)
        ? error.message
        : "An error occurred";
    console.error("Change password error:", error);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }
}
