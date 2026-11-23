import { getStoreByDomain } from "@/lib/queries";
import { getDemoMode } from "@/lib/demo-mode";
import { loadScanSummaryForStore } from "@/lib/scan-summary-loader";
import { notFound } from "next/navigation";
import StoreDetail from "@/components/store-detail";
import TopBar from "@/components/top-bar";

export default async function StoreDetailPage({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const decoded = decodeURIComponent(domain);
  const [store, demoMode, initialScanSummary] = await Promise.all([
    getStoreByDomain(decoded),
    getDemoMode(),
    loadScanSummaryForStore(decoded),
  ]);

  if (!store) notFound();

  return (
    <div className="space-y-8">
      <div>
        <TopBar title={store.shopName} demoMode={demoMode} />
        <p className="text-muted-foreground">{store.shopDomain}</p>
      </div>
      <StoreDetail
        store={store}
        demoMode={demoMode === "on"}
        initialScanSummary={initialScanSummary}
      />
    </div>
  );
}
