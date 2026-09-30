import { getIronSession, type IronSession } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

export interface AdminSession {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isLoggedIn: boolean;
  /** Bumped on password change so existing cookies stop validating. */
  sessionVersion: number;
}

const SESSION_PASSWORD = process.env.ADMIN_SESSION_PASSWORD;

// Fail loudly in EVERY environment. There is deliberately NO fallback key: a
// committed or guessable session-encryption key is a complete authentication
// bypass, because anyone holding it can mint a valid admin-session cookie
// offline. This check runs at import time so a missing/weak secret is caught
// on boot rather than surfacing later as a confusing auth bug.
if (!SESSION_PASSWORD || SESSION_PASSWORD.length < 32) {
  throw new Error(
    "ADMIN_SESSION_PASSWORD must be set to a random string of at least 32 " +
      "characters. Generate one with: openssl rand -base64 48",
  );
}

/** 7 days. Must match the cookie Max-Age below — iron-session otherwise
 *  defaults its seal `ttl` to 14 days, so a captured cookie would stay
 *  replayable for a week after the browser discards it. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Secure by DEFAULT. Plain-HTTP local development is the only exception and
 *  must be opted into explicitly, so a missing NODE_ENV can never silently
 *  disable transport security on a real deployment. */
const COOKIE_SECURE = process.env.ADMIN_SESSION_INSECURE_COOKIE !== "1";

/** Compared against when no admin matches, so an unknown email costs the same
 *  as a known one and cannot be distinguished by response timing. */
const DUMMY_PASSWORD_HASH =
  "$2a$12$LEuOmXC2Mbyhr3Ve6mPsXeB3Z3Tm9UqdW7ihXPXKYp/Sx/N8x0136";

/** `AdminUser.email` is a case-sensitive TEXT @unique, so "Admin@x.com" and
 *  "admin@x.com" would otherwise be two separate accounts. */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export async function getAdminSession(): Promise<IronSession<AdminSession>> {
  const cookieStore = await cookies();
  return getIronSession<AdminSession>(cookieStore, {
    password: SESSION_PASSWORD as string,
    cookieName: "admin-session",
    ttl: SESSION_TTL_SECONDS,
    cookieOptions: {
      secure: COOKIE_SECURE,
      httpOnly: true,
      sameSite: "lax",
      maxAge: SESSION_TTL_SECONDS,
    },
  });
}

export async function loginAdmin(email: string, password: string) {
  const user = await prisma.adminUser.findUnique({
    where: { email: normalizeEmail(email) },
  });

  // Always pay the bcrypt cost, even for an unknown account, so response time
  // does not reveal whether the email exists.
  const isValid = await bcrypt.compare(
    password,
    user ? user.passwordHash : DUMMY_PASSWORD_HASH,
  );
  if (!user || !isValid) return null;

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
  session.sessionVersion = user.sessionVersion;
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
  if (!session.isLoggedIn || !session.userId) {
    return null;
  }

  // The cookie only proves the session was sealed with our key. Re-read the
  // user so a deleted account, a role change, or a password change (which bumps
  // sessionVersion) actually revokes access instead of leaving a stale cookie
  // valid.
  const user = await prisma.adminUser.findUnique({
    where: { id: session.userId },
  });
  if (!user) return null;
  if (user.sessionVersion !== (session.sessionVersion ?? 0)) return null;

  return { ...session, email: user.email, name: user.name, role: user.role };
}

/**
 * Enforces the `role` column, which is otherwise decorative. A `viewer`
 * account must not reach admin-only surfaces.
 */
export async function requireRole(required: "admin" | "viewer" = "admin") {
  const session = await requireAdmin();
  if (!session) return null;
  if (session.role !== required) return null;
  return session;
}

export async function hasAnyAdminUser(): Promise<boolean> {
  const count = await prisma.adminUser.count();
  return count > 0;
}

/**
 * `client` lets the caller supply a transaction handle so the first-run setup
 * guard and this insert can be atomic (see api/auth/setup/route.ts).
 */
type AdminUserWriter = Pick<Prisma.TransactionClient, "adminUser">;

export async function createAdminUser(
  input: { email: string; password: string; name?: string },
  client: AdminUserWriter = prisma,
) {
  const passwordHash = await bcrypt.hash(input.password, 12);
  return client.adminUser.create({
    data: {
      email: normalizeEmail(input.email),
      passwordHash,
      name: input.name,
      role: "admin",
    },
  }) as ReturnType<typeof prisma.adminUser.create>;
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
    where: { email: normalizeEmail(input.email) },
  });
  if (existing && existing.id !== userId) {
    throw new Error("Email is already in use by another account");
  }

  const user = await prisma.adminUser.update({
    where: { id: userId },
    data: { name: input.name, email: normalizeEmail(input.email) },
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
    data: { passwordHash, sessionVersion: { increment: 1 } },
  });
}
