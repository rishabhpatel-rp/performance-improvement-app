import { redirect } from "next/navigation";
import { requireAdmin, hasAnyAdminUser } from "@/lib/auth";

// Middleware already redirects "/" based on cookie presence, but this
// server component is the source of truth: it validates the session for
// real and falls back to /setup when no admin user exists yet.
export default async function RootPage() {
  const session = await requireAdmin();
  if (session) {
    redirect("/dashboard");
  }

  const hasAdmin = await hasAnyAdminUser();
  if (!hasAdmin) {
    redirect("/setup");
  }

  redirect("/login");
}
