// Live, per-session demo-data toggle. Replaces the old static
// `SHOW_DUMMY_DATA` env flag with a cookie so the UI can switch between
// real database data and the in-memory dummy dataset without a restart.
//
// Uses `next/headers`, so this module must only be imported from server
// components, route handlers, or other server-only code (e.g. queries.ts).
import { cookies } from "next/headers";
import { showDummyData } from "./data-source";

export type DemoMode = "on" | "off";

const COOKIE_NAME = "demo_mode";

export async function getDemoMode(): Promise<DemoMode> {
  const cookieStore = await cookies();
  const value = cookieStore.get(COOKIE_NAME)?.value;

  if (value === "on" || value === "off") return value;

  // Graceful migration: if no cookie has been set yet, fall back to the
  // legacy env flag so existing deployments keep their current behavior
  // until someone flips the toggle in the UI.
  return showDummyData ? "on" : "off";
}

export async function setDemoMode(value: DemoMode): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, value, {
    path: "/",
    sameSite: "lax",
    // 1 year — this is a UI preference, not a security-sensitive cookie.
    maxAge: 60 * 60 * 24 * 365,
  });
}
