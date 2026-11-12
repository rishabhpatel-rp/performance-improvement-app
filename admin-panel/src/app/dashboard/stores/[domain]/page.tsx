import { getLatestCompletedAudit, getStoreByDomain } from "@/lib/queries";
import { getDemoMode } from "@/lib/demo-mode";
import { notFound } from "next/navigation";
import StoreDetail from "@/components/store-detail";
import StoreScriptEditor from "@/components/store-script-editor";
import TopBar from "@/components/top-bar";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const decoded = decodeURIComponent(domain);
  const [store, demoMode, audit] = await Promise.all([
    getStoreByDomain(decoded),
    getDemoMode(),
    getLatestCompletedAudit(decoded),
  ]);

  if (!store) notFound();

  const config = asRecord(store.configs?.[0]) ?? null;
  const script = asRecord(
    "performanceScript" in store ? store.performanceScript : null,
  );
  const auditData = asRecord(audit?.audit_data);
  const inventory = asRecord(auditData?.scriptInventory);
  const byToken = Array.isArray(inventory?.byToken) ? inventory.byToken : [];
  const summary = auditData
    ? {
        topScripts: byToken.flatMap((row) => {
          const item = asRecord(row);
          if (!item || typeof item.token !== "string") return [];
          return [{
            token: item.token,
            status: typeof item.status === "string" ? item.status : "",
            pages: Array.isArray(item.pages)
              ? item.pages.filter((p): p is string => typeof p === "string")
              : [],
          }];
        }),
        pageRoles: Object.fromEntries(
          Object.entries(asRecord(auditData.pageRoles) || {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        ),
      }
    : null;

  return (
    <div className="space-y-8">
      <div>
        <TopBar title={store.shopName} demoMode={demoMode} />
        <p className="text-muted-foreground">{store.shopDomain}</p>
      </div>
      <StoreDetail store={store} demoMode={demoMode === "on"} />
      <StoreScriptEditor
        domain={store.shopDomain}
        config={config}
        appEnabled={config?.appEnabled === true}
        readableScript={typeof script?.readableScript === "string" ? script.readableScript : ""}
        hiddenCss={typeof script?.hiddenCss === "string" ? script.hiddenCss : ""}
        scriptBuiltAt={
          script?.scriptBuiltAt instanceof Date
            ? script.scriptBuiltAt.toISOString()
            : typeof script?.scriptBuiltAt === "string"
              ? script.scriptBuiltAt
              : null
        }
        metafieldSyncedAt={
          script?.metafieldSyncedAt instanceof Date
            ? script.metafieldSyncedAt.toISOString()
            : typeof script?.metafieldSyncedAt === "string"
              ? script.metafieldSyncedAt
              : null
        }
        summary={summary}
        readOnly={store.id.startsWith("dummy_")}
      />
    </div>
  );
}
