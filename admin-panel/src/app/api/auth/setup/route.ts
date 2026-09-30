import { NextResponse } from "next/server";
import { hasAnyAdminUser, createAdminUser, loginAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

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

    const body = await request.json();
    const email = typeof body?.email === "string" ? body.email : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const name = typeof body?.name === "string" ? body.name : undefined;

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

    // Re-check and create inside ONE serializable transaction. The pre-check
    // above is only a fast path: without this, two concurrent requests with
    // different emails both observe count()==0 and both insert, creating two
    // privileged admins from an unauthenticated call pair.
    const created = await prisma.$transaction(
      async (tx) => {
        const count = await tx.adminUser.count();
        if (count > 0) return null;
        return createAdminUser({ email, password, name }, tx);
      },
      { isolationLevel: "Serializable" },
    );
    if (!created) {
      return NextResponse.json(
        { success: false, error: "Setup has already been completed" },
        { status: 409 },
      );
    }

    const user = await loginAdmin(email, password);
    if (!user) {
      return NextResponse.json(
        { success: false, error: "Could not sign in after creating the account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { success: false, error: "An error occurred" },
      { status: 500 },
    );
  }
}
