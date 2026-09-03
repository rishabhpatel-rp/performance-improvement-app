import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { getDemoMode } from "@/lib/demo-mode";
import SettingsClient from "@/components/settings-client";

export default async function SettingsPage() {
  const session = await requireAdmin();
  if (!session) redirect("/login");

  const user = {
    userId: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    isLoggedIn: session.isLoggedIn,
  };

  const demoMode = await getDemoMode();

  return <SettingsClient user={user} demoMode={demoMode} />;
}
