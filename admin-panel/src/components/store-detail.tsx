"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import ConfigViewer from "@/components/config-viewer";
import Step2ConfigureClient from "@/components/step2/step2-configure-client";
import StoreScriptDiagnostics from "@/components/store-script-diagnostics";
import StoreControlPanel from "@/components/store-control-panel";
import StoreAdminHeadHtml from "@/components/store-admin-head-html";
import StorePurgePanel from "@/components/store-purge-panel";
import ActivityTimeline from "@/components/activity-timeline";
import type { StoreWithDetails } from "@/lib/types";

type Store = NonNullable<StoreWithDetails>;

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right break-all">{value ?? "—"}</span>
    </div>
  );
}

function scriptIso(
  value: Date | string | null | undefined,
): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

export default function StoreDetail({
  store,
  demoMode = false,
}: {
  store: Store;
  demoMode?: boolean;
}) {
  const [tab, setTab] = useState<"config" | "activity">("config");
  const config = store.configs[0] ?? null;
  const readOnly = demoMode || store.id.startsWith("dummy_");
  const ps = store.performanceScript;

  const shopifyAdminUrl = `https://${store.shopDomain}/admin`;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Store Info</CardTitle>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            <div className="pb-2">
              <InfoRow label="Shop Name" value={store.shopName} />
              <InfoRow
                label="Domain"
                value={
                  <a
                    href={shopifyAdminUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-primary hover:underline"
                  >
                    {store.shopDomain}
                  </a>
                }
              />
              <InfoRow label="Email" value={store.email} />
            </div>

            <div className="py-2">
              <InfoRow label="Country" value={store.countryName || store.country} />
              <InfoRow label="City" value={store.city} />
              <InfoRow
                label="Address"
                value={[store.address1, store.address2, store.zip]
                  .filter(Boolean)
                  .join(", ") || undefined}
              />
            </div>

            <div className="py-2">
              <InfoRow label="Timezone" value={store.ianaTimezone || store.timezone} />
              <InfoRow label="Currency" value={store.currency} />
              <InfoRow label="Locale" value={store.locale} />
            </div>

            <div className="py-2">
              <InfoRow label="Shopify Plan" value={store.shopifyPlan} />
              <InfoRow label="Products" value={store.totalProducts ?? undefined} />
              <InfoRow label="Orders" value={store.totalOrders ?? undefined} />
            </div>

            <div className="py-2">
              <InfoRow label="Shop Created" value={formatDate(store.createdAtShopify)} />
              <InfoRow label="App Installed" value={formatDate(store.installedAt)} />
              {!store.isActive && (
                <InfoRow label="App Uninstalled" value={formatDate(store.uninstalledAt)} />
              )}
              <InfoRow label="Last Synced" value={formatDate(store.lastSyncedAt)} />
            </div>

            <div className="pt-2">
              <InfoRow label="Current Scope" value={store.currentScope} />
              {ps && (
                <>
                  <InfoRow label="Script built" value={formatDate(ps.scriptBuiltAt)} />
                  <InfoRow
                    label="Script hash"
                    value={
                      ps.scriptHash ? `${ps.scriptHash.slice(0, 12)}…` : undefined
                    }
                  />
                  <InfoRow
                    label="Metafield synced"
                    value={formatDate(ps.metafieldSyncedAt)}
                  />
                </>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader className="pb-0">
            <div className="flex gap-1 border-b border-border -mb-px">
              <TabButton active={tab === "config"} onClick={() => setTab("config")}>
                Configuration
              </TabButton>
              <TabButton
                active={tab === "activity"}
                onClick={() => setTab("activity")}
              >
                Activity Timeline
                {store.activities.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({store.activities.length})
                  </span>
                )}
              </TabButton>
            </div>
          </CardHeader>
          <CardContent className="pt-6">
            {tab === "config" ? (
              <ConfigViewer config={config} />
            ) : (
              <ActivityTimeline activities={store.activities} />
            )}
          </CardContent>
        </Card>
      </div>

      <StoreControlPanel
        domain={store.shopDomain}
        initialAppEnabled={config?.appEnabled === true}
        initialAdminManaged={
          (config as { adminManaged?: boolean } | null)?.adminManaged === true
        }
        readOnly={readOnly}
      />

      <Step2ConfigureClient
        domain={store.shopDomain}
        initialConfig={(config ?? null) as unknown as Record<string, unknown> | null}
        appEnabled={config?.appEnabled === true}
        readOnly={readOnly}
      />

      <StoreScriptDiagnostics
        readableScript={ps?.readableScript ?? ""}
        scriptBuiltAt={scriptIso(ps?.scriptBuiltAt)}
        metafieldSyncedAt={scriptIso(ps?.metafieldSyncedAt)}
        scriptHash={ps?.scriptHash ?? null}
      />

      <StoreAdminHeadHtml
        domain={store.shopDomain}
        initialHtml={(config as { adminHeadHtml?: string | null } | null)?.adminHeadHtml ?? ""}
        readOnly={readOnly}
      />

      <StorePurgePanel
        domain={store.shopDomain}
        shopName={store.shopName}
        isActive={store.isActive}
        readOnly={readOnly}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
        active
          ? "border-primary text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}