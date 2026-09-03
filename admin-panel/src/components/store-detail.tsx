"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import ConfigViewer from "@/components/config-viewer";
import ActivityTimeline from "@/components/activity-timeline";
import type { StoreWithDetails } from "@/lib/queries";

type Store = NonNullable<StoreWithDetails>;

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className="text-right break-all">{value ?? "—"}</span>
    </div>
  );
}

export default function StoreDetail({ store }: { store: Store }) {
  const [tab, setTab] = useState<"config" | "activity">("config");
  const config = store.configs[0] ?? null;

  const shopifyAdminUrl = `https://${store.shopDomain}/admin`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Left column — Store Info */}
      <Card className="lg:col-span-1 h-fit">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Store Info
            <Badge variant={store.isActive ? "success" : "destructive"}>
              {store.isActive ? "Active" : "Inactive"}
            </Badge>
          </CardTitle>
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
              value={[store.address1, store.address2, store.zip].filter(Boolean).join(", ") || undefined}
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
          </div>
        </CardContent>
      </Card>

      {/* Right column — Tabs */}
      <Card className="lg:col-span-2 h-fit">
        <CardHeader className="pb-0">
          <div className="flex gap-1 border-b border-border -mb-px">
            <TabButton active={tab === "config"} onClick={() => setTab("config")}>
              Configuration
            </TabButton>
            <TabButton active={tab === "activity"} onClick={() => setTab("activity")}>
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
