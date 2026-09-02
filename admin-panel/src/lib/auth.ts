import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export interface AdminSession {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isLoggedIn: boolean;
}

const SESSION_PASSWORD = process.env.ADMIN_SESSION_PASSWORD;

if (!SESSION_PASSWORD || SESSION_PASSWORD.length < 32) {
  // Fail loudly in any environment rather than silently running with a
  // predictable session-encryption key. This check runs at import time so
  // a missing/weak secret is caught immediately rather than surfacing as a
  // confusing auth bug later.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "ADMIN_SESSION_PASSWORD must be set to a random string of at least 32 characters.",
    );
  } else {
    console.warn(
      "[auth] ADMIN_SESSION_PASSWORD is missing or too short. Using an " +
        "insecure development fallback — set a real value in .env before " +
        "deploying.",
    );
  }
}

const RESOLVED_SESSION_PASSWORD =
  SESSION_PASSWORD && SESSION_PASSWORD.length >= 32
    ? SESSION_PASSWORD
    : "dev-only-insecure-session-password-change-me-32c";

export async function getAdminSession(): Promise<IronSession<AdminSession>> {
  const cookieStore = await cookies();
  return getIronSession<AdminSession>(cookieStore, {
    password: RESOLVED_SESSION_PASSWORD,
    cookieName: "admin-session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  });
}

export async function loginAdmin(email: string, password: string) {
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) return null;

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return null;

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const session = await getAdminSession();
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  session.role = user.role;
  session.isLoggedIn = true;
  await session.save();

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function logoutAdmin() {
  const session = await getAdminSession();
  session.destroy();
}

/**
 * Returns the current session if the visitor is logged in, otherwise null.
 * Use this in server components / route handlers that need to branch on
 * auth state without forcing a redirect (the dashboard layout does the
 * redirecting).
 */
export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session.isLoggedIn) {
    return null;
  }
  return session;
}

export async function hasAnyAdminUser(): Promise<boolean> {
  const count = await prisma.adminUser.count();
  return count > 0;
}

export async function createAdminUser(input: {
  email: string;
  password: string;
  name?: string;
}) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return prisma.adminUser.create({
    data: {
      email: input.email,
      passwordHash,
      name: input.name,
      role: "admin",
    },
  });
}

/**
 * Updates the profile (name/email) for the currently logged-in admin and
 * refreshes the session cookie so the sidebar/etc reflect the change
 * immediately without requiring a re-login.
 */
export async function updateAdminProfile(
  userId: string,
  input: { name?: string; email: string },
) {
  const existing = await prisma.adminUser.findUnique({
    where: { email: input.email },
  });
  if (existing && existing.id !== userId) {
    throw new Error("Email is already in use by another account");
  }

  const user = await prisma.adminUser.update({
    where: { id: userId },
    data: { name: input.name, email: input.email },
  });

  const session = await getAdminSession();
  if (session.userId === userId) {
    session.email = user.email;
    session.name = user.name;
    await session.save();
  }

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

/**
 * Changes the password for the currently logged-in admin. Requires the
 * current password to be supplied and verified — this is a self-service
 * flow, not an admin-reset-another-user flow, so there is no bypass.
 */
export async function changeAdminPassword(
  userId: string,
  input: { currentPassword: string; newPassword: string },
) {
  const user = await prisma.adminUser.findUnique({ where: { id: userId } });
  if (!user) throw new Error("User not found");

  const isValid = await bcrypt.compare(input.currentPassword, user.passwordHash);
  if (!isValid) throw new Error("Current password is incorrect");

  const passwordHash = await bcrypt.hash(input.newPassword, 12);
  await prisma.adminUser.update({
    where: { id: userId },
    data: { passwordHash },
  });
}
