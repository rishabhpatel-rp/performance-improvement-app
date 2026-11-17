"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Step2ConfigureView from "@/components/step2/step2-configure";
import type { SaveBoxPayload } from "@/components/step2/step2-titles";
import type { AuditSummaryPayload } from "@/components/step2/step2-audit-table";
import type { TemplateScope } from "@/lib/storefront-lists";
import { fieldsForScope } from "@/lib/step2-field-helpers";

type StateResponse = {
  ok?: boolean;
  error?: string;
  config?: Record<string, unknown>;
  auditStatus?: { running?: boolean; complete?: boolean; failed?: boolean };
  auditReportSummary?: AuditSummaryPayload | null;
  version?: { configUpdatedAt?: string | null; scriptHash?: string | null };
  metafieldStatus?: string;
};

export default function Step2ConfigureClient({
  domain,
  initialConfig,
  appEnabled,
  readOnly,
}: {
  domain: string;
  initialConfig: Record<string, unknown> | null;
  appEnabled: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [config, setConfig] = useState<Record<string, unknown>>(
    initialConfig ?? {},
  );
  const [auditStatus, setAuditStatus] = useState<StateResponse["auditStatus"]>(
    {},
  );
  const [auditReportSummary, setAuditReportSummary] =
    useState<AuditSummaryPayload | null>(null);
  const [stateError, setStateError] = useState<string | null>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [metafieldWarning, setMetafieldWarning] = useState(false);
  const [pendingToken, setPendingToken] = useState<string | null>(null);
  const [resyncing, setResyncing] = useState(false);
  const versionKeyRef = useRef("");

  const applyState = useCallback((data: StateResponse) => {
    if (data.config) setConfig(data.config);
    if (data.auditStatus) setAuditStatus(data.auditStatus);
    if (data.auditReportSummary !== undefined) {
      setAuditReportSummary(data.auditReportSummary);
    }
    if (data.version) {
      versionKeyRef.current = `${data.version.configUpdatedAt ?? ""}|${data.version.scriptHash ?? ""}`;
    }
  }, []);

  const loadState = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/stores/${encodeURIComponent(domain)}/state`,
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => null)) as StateResponse | null;
      if (!res.ok || !data?.ok) {
        setStateError(data?.error || `HTTP ${res.status}`);
        return;
      }
      setStateError(null);
      applyState(data);
    } catch (err) {
      setStateError(err instanceof Error ? err.message : "Request failed");
    }
  }, [domain, applyState]);

  useEffect(() => {
    void loadState();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadState();
    }, 5000);
    return () => clearInterval(id);
  }, [loadState]);

  async function post(
    body: Record<string, unknown>,
    key: string,
    scope: TemplateScope = "global",
  ) {
    setSavingKey(key);
    setSaveError(null);
    try {
      const res = await fetch(
        `/api/stores/${encodeURIComponent(domain)}/script`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, scope: body.scope ?? scope }),
          cache: "no-store",
        },
      );
      const data = (await res.json().catch(() => null)) as StateResponse;
      if (!res.ok || !data?.ok) {
        setSaveError(data?.error || `Save failed (HTTP ${res.status}).`);
        return false;
      }
      if (data.config) setConfig(data.config);
      if (data.version) {
        versionKeyRef.current = `${data.version.configUpdatedAt ?? ""}|${data.version.scriptHash ?? ""}`;
      }
      setMetafieldWarning(data.metafieldStatus === "failed");
      router.refresh();
      return true;
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
      return false;
    } finally {
      setSavingKey(null);
      setPendingToken(null);
    }
  }

  return (
    <Step2ConfigureView
      config={config}
      auditStatus={auditStatus ?? {}}
      auditReportSummary={auditReportSummary}
      appEnabled={appEnabled}
      readOnly={readOnly}
      stateError={stateError}
      savingKey={savingKey}
      saveError={saveError}
      metafieldWarning={metafieldWarning}
      pendingToken={pendingToken}
      onToggle={(field, enabled) => {
        void post({ intent: "toggle", field, enabled }, `toggle:${field}`, "global");
      }}
      onSave={(payload: SaveBoxPayload) => {
        const field = fieldsForScope(payload.scope).find(
          (f) => f.listFamily === payload.family,
        );
        const key = field?.key ?? payload.family;
        const patch: Record<string, unknown> = {};
        if (payload.list) patch[payload.family] = payload.list;
        if (payload.firstMs != null) patch.firstMs = payload.firstMs;
        if (payload.everyMs != null) patch.everyMs = payload.everyMs;
        void post(
          { intent: "save-lists", scope: payload.scope, patch },
          key,
          payload.scope,
        );
      }}
      onTokenAction={(token, action, scope) => {
        setPendingToken(token);
        void post(
          { intent: "script-token-action", token, action },
          `token:${token}`,
          scope,
        );
      }}
      onResync={() => {
        setResyncing(true);
        void post({ intent: "resync" }, "resync", "global").finally(() =>
          setResyncing(false),
        );
      }}
      resyncing={resyncing}
    />
  );
}
