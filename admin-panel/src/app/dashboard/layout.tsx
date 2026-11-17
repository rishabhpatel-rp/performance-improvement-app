import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/sidebar";
import BridgeHint from "@/components/bridge-hint";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  if (!session) redirect("/login");

  // Pass a plain serializable object to the client component — the
  // IronSession instance itself carries non-serializable methods
  // (save/destroy) that shouldn't cross the server/client boundary.
  const user = {
    userId: session.userId,
    email: session.email,
    name: session.name,
    role: session.role,
    isLoggedIn: session.isLoggedIn,
    sessionVersion: session.sessionVersion ?? 0,
  };

  return (
    <div className="min-h-screen flex">
      <Sidebar user={user} />
      <main style={{ width: "calc(100% - 16rem)" }} className="flex-1 p-8 bg-gray-50">
        <BridgeHint />
        {children}
      </main>
    </div>
  );
}
