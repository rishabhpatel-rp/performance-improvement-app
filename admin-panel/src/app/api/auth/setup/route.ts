import { NextResponse } from "next/server";
import { hasAnyAdminUser, createAdminUser, loginAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    // Guard: this endpoint only ever works once. If an admin user already
    // exists, refuse — first-run setup must not become a backdoor for
    // creating additional privileged accounts.
    if (await hasAnyAdminUser()) {
      return NextResponse.json(
        { success: false, error: "Setup has already been completed" },
        { status: 409 },
      );
    }

    const { email, password, name } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 },
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { success: false, error: "Password must be at least 8 characters" },
        { status: 400 },
      );
    }

    await createAdminUser({ email, password, name });
    const user = await loginAdmin(email, password);

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { success: false, error: "An error occurred" },
      { status: 500 },
    );
  }
}
