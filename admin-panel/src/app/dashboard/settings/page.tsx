import { requireAdmin } from "@/lib/auth";
import { getDemoMode } from "@/lib/demo-mode";
import { getStep2OfferPopupEnabled } from "@/lib/global-settings";
import PopupControlCard from "@/components/popup-control-card";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [session, enabled, demoMode] = await Promise.all([
    requireAdmin(),
    getStep2OfferPopupEnabled(),
    getDemoMode(),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Settings</h1>
      <PopupControlCard
        initialEnabled={enabled}
        canEdit={session?.role === "admin" && demoMode !== "on"}
        demoMode={demoMode === "on"}
      />
    </div>
  );
}
