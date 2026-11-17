"use client";

import { useState } from "react";
import type { TemplateScope } from "@/lib/storefront-lists";
import { PpAuditStyles } from "@/components/pp/pp-styles";
import { PpBanner, PpSpinner } from "@/components/pp/polaris-shims";
import Step2Titles, { type SaveBoxPayload } from "@/components/step2/step2-titles";
import Step2AuditTable, {
  type AuditSummaryPayload,
} from "@/components/step2/step2-audit-table";

const TABS: { id: TemplateScope; label: string }[] = [
  { id: "global", label: "Global" },
  { id: "home", label: "Home" },
  { id: "collection", label: "PLP" },
  { id: "product", label: "PDP" },
];

export default function Step2ConfigureView({
  config,
  auditStatus,
  auditReportSummary,
  appEnabled,
  readOnly,
  stateError,
  savingKey,
  saveError,
  metafieldWarning,
  pendingToken,
  onToggle,
  onSave,
  onTokenAction,
  onResync,
  resyncing,
}: {
  config: Record<string, unknown>;
  auditStatus: { running?: boolean; complete?: boolean; failed?: boolean };
  auditReportSummary: AuditSummaryPayload | null;
  appEnabled: boolean;
  readOnly?: boolean;
  stateError: string | null;
  savingKey: string | null;
  saveError: string | null;
  metafieldWarning: boolean;
  pendingToken: string | null;
  onToggle: (field: string, enabled: boolean) => void;
  onSave: (payload: SaveBoxPayload) => void;
  onTokenAction: (token: string, action: string, scope: TemplateScope) => void;
  onResync: () => void;
  resyncing: boolean;
}) {
  const [scope, setScope] = useState<TemplateScope>("global");
  const showDisabledBanner = !appEnabled;

  return (
    <div className="pp-step2-wrap rounded-lg border bg-card p-6">
      <PpAuditStyles />
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <h2
          style={{
            fontSize: 17,
            fontWeight: 700,
            color: "#111827",
            margin: 0,
          }}
        >
          Step 2: Configure
        </h2>
        {metafieldWarning && !readOnly && (
          <button
            type="button"
            className="pp-btn-secondary-sm"
            disabled={resyncing}
            onClick={onResync}
          >
            {resyncing ? "Retrying…" : "Retry metafield sync"}
          </button>
        )}
      </div>

      {readOnly && (
        <PpBanner tone="info">Demo store — editing is disabled.</PpBanner>
      )}
      {stateError && (
        <PpBanner tone="warning">
          Merchant app not reachable: {stateError}. Showing last known data.
        </PpBanner>
      )}
      {showDisabledBanner && (
        <PpBanner tone="info">Enable the app in Step 1 first.</PpBanner>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setScope(tab.id)}
            style={{
              borderRadius: 999,
              border:
                scope === tab.id ? "1px solid #111827" : "1px solid #E5E7EB",
              background: scope === tab.id ? "#111827" : "#fff",
              color: scope === tab.id ? "#fff" : "#374151",
              padding: "6px 14px",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>
      {scope !== "global" && (
        <p style={{ fontSize: 13, color: "#6B7177", marginTop: 8 }}>
          This page also uses every name in the Global tab.
        </p>
      )}

      <Step2Titles
        config={config}
        scope={scope}
        readOnly={readOnly}
        savingKey={savingKey}
        saveError={saveError}
        metafieldWarning={metafieldWarning}
        onToggle={onToggle}
        onSave={onSave}
      />

      <Step2AuditSection
        appEnabled={appEnabled}
        auditStatus={auditStatus}
        auditReportSummary={auditReportSummary}
        config={config}
        scope={scope}
        pendingToken={pendingToken}
        readOnly={readOnly}
        onTokenAction={onTokenAction}
      />
    </div>
  );
}

function Step2AuditSection({
  appEnabled,
  auditStatus,
  auditReportSummary,
  config,
  scope,
  pendingToken,
  readOnly,
  onTokenAction,
}: {
  appEnabled: boolean;
  auditStatus: { running?: boolean; complete?: boolean; failed?: boolean };
  auditReportSummary: AuditSummaryPayload | null;
  config: Record<string, unknown>;
  scope: TemplateScope;
  pendingToken: string | null;
  readOnly?: boolean;
  onTokenAction: (token: string, action: string, scope: TemplateScope) => void;
}) {
  if (!appEnabled) {
    return (
      <PpBanner tone="info">
        Enable PagePulse in Step 1 to run a scan and see results.
      </PpBanner>
    );
  }
  if (auditStatus?.running) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 24 }}>
        <PpSpinner />
        <span style={{ fontSize: 13, color: "#6B7177" }}>
          Scan in progress — results appear here when the audit finishes.
        </span>
      </div>
    );
  }
  if (!auditReportSummary) {
    return null;
  }
  return (
    <Step2AuditTable
      summary={auditReportSummary}
      config={config}
      scope={scope}
      pendingToken={pendingToken}
      readOnly={readOnly}
      onTokenAction={(token, action) => onTokenAction(token, action, scope)}
    />
  );
}
