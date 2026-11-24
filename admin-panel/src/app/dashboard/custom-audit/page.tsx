import { requireAdmin } from "@/lib/auth";
import { getDemoMode } from "@/lib/demo-mode";
import { PpAuditStyles } from "@/components/pp/pp-styles";
import CustomAuditForm from "@/components/custom-audit-form";

export const dynamic = "force-dynamic";

export default async function CustomAuditPage() {
  const [session, demoMode] = await Promise.all([requireAdmin(), getDemoMode()]);

  return (
    <div className="space-y-6">
      <PpAuditStyles />
      <h1 className="text-3xl font-bold">Custom audit</h1>
      <CustomAuditForm
        canEdit={session?.role === "admin" && demoMode !== "on"}
        demoMode={demoMode === "on"}
      />
    </div>
  );
}
