"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn, formatDate } from "@/lib/utils";
import ConfigViewer from "@/components/config-viewer";
import StoreScriptEditor from "@/components/store-script-editor";
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

export default function StoreDetail({
  store,
  demoMode = false,
}: {
  store: Store;
  demoMode?: boolean;
}) {
  const [tab, setTab] = useState<"config" | "activity">("config");
  const config = store.configs[0] ?? null;

  const shopifyAdminUrl = `https://${store.shopDomain}/admin`;

  return (
    <div className="space-y-8">
      {/* Left column — Store Info */}
      <Card>
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
            {store.performanceScript && (
              <>
                <InfoRow
                  label="Script built"
                  value={formatDate(store.performanceScript.scriptBuiltAt)}
                />
                <InfoRow
                  label="Script hash"
                  value={
                    store.performanceScript.scriptHash
                      ? `${store.performanceScript.scriptHash.slice(0, 12)}…`
                      : undefined
                  }
                />
                <InfoRow
                  label="Metafield synced"
                  value={formatDate(store.performanceScript.metafieldSyncedAt)}
                />
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Right column — Tabs */}
      <Card>
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

      <StoreScriptEditor
        domain={store.shopDomain}
        config={config}
        appEnabled={config?.appEnabled === true}
        readableScript={store.performanceScript?.readableScript ?? ""}
        hiddenCss={store.performanceScript?.hiddenCss ?? ""}
        scriptBuiltAt={
          store.performanceScript?.scriptBuiltAt instanceof Date
            ? store.performanceScript.scriptBuiltAt.toISOString()
            : store.performanceScript?.scriptBuiltAt ?? ""
        }
        metafieldSyncedAt={
          store.performanceScript?.metafieldSyncedAt instanceof Date
            ? store.performanceScript.metafieldSyncedAt.toISOString()
            : store.performanceScript?.metafieldSyncedAt ?? ""
        }
        scriptHash={
          store.performanceScript?.scriptHash ?? ""
        }
        summary={store.auditSummary ? {
          topScripts: [],
          pageRoles: {}
        } : null}
        auditSummary={store.auditSummary ?? null}
        readOnly={demoMode || store.id.startsWith("dummy_")}
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