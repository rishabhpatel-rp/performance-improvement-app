import { messages } from "../lib/messages.ts";
import SupportError from "./SupportError.tsx";
/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy components */
import { useState, useEffect, useRef } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { PREDEFINED_SCRIPTS } from "../lib/scripts";
import Step3Titles from "./Step3Titles";
import Step3AuditResults from "./Step3AuditResults";

interface Props {
  config?: Record<string, any> | null;
  auditStatus?: any;
  appEnabled?: boolean;
  configVersion?: any;
  readOnly?: boolean;
}

const TABS = [
  { id: "global", label: "Global" },
  { id: "home", label: "Home" },
  { id: "collection", label: "PLP" },
  { id: "product", label: "PDP" },
];

const FIELD_BY_INDEX = ["script1Enabled", "script2Enabled", "script3Enabled"];

/**
 * Step 2 — one toggle per predefined script (Audit / Defer / Hide CSS),
 * labeled with the current title from config.scriptTitles[i] (falling back
 * to the script's default name, purely cosmetic). Toggles are disabled
 * while the app itself is off.
 */
export default function Step2Configure({
  config,
  auditStatus,
  appEnabled,
  configVersion,
  readOnly = false,
}: Props) {
  const fetcher: any = useFetcher();
  const revalidator = useRevalidator();
  const [scope, setScope] = useState("global");
  const versionKeyRef = useRef(
    configVersion ? `${configVersion.configUpdatedAt}|${configVersion.scriptHash}` : "",
  );

  useEffect(() => {
    if (!configVersion) return;
    versionKeyRef.current = `${configVersion.configUpdatedAt}|${configVersion.scriptHash}`;
  }, [configVersion]);

  useEffect(() => {
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/config-version");
        if (!res.ok) return;
        const next = await res.json();
        const key = `${next.configUpdatedAt}|${next.scriptHash}`;
        if (key !== versionKeyRef.current) {
          versionKeyRef.current = key;
          void revalidator.revalidate();
        }
      } catch {
        /* ignore transient polling errors */
      }
    };
    const id = setInterval(poll, 5000);
    return () => clearInterval(id);
  }, [revalidator]);

  // Merge action response into config for fresh state after toggle
  const liveConfig = fetcher.data?.config ? { ...config, ...fetcher.data.config } : config;

  const handleToggle = (index: any, checked: any) => {
    fetcher.submit(
      {
        intent: "toggle-script",
        scriptIndex: String(index),
        enabled: String(checked),
      },
      { method: "POST" },
    );
  };

  const showScriptToggles = PREDEFINED_SCRIPTS.length > 0;
  const showDisabledBanner = !liveConfig.appEnabled;

  return (
    <s-section heading="Step 2: Configure">
      {(showDisabledBanner || showScriptToggles) && (
        <s-stack direction="block" gap="base">
          {showDisabledBanner && <s-banner tone="info">Enable the app in Step 1 first.</s-banner>}
          <s-text tone="subdued">{messages.delayWarning}</s-text>

          <s-text tone="subdued" role="status" aria-live="polite">
            {fetcher.data?.ok === false && (
              <SupportError title="We couldn't save that change" error={fetcher.data?.error} />
            )}

            {fetcher.state !== "idle" ? messages.saving : fetcher.data?.ok ? messages.saved : ""}
          </s-text>

          {PREDEFINED_SCRIPTS.map((script, index) => (
            <s-stack key={script.id} direction="block" gap="tight">
              <s-switch
                label={liveConfig.scriptTitles[index] || script.name}
                checked={liveConfig[FIELD_BY_INDEX[index]]}
                disabled={!liveConfig.appEnabled}
                onChange={(e: any) => handleToggle(index, e.target.checked)}
              />
            </s-stack>
          ))}
        </s-stack>
      )}

      <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setScope(tab.id)}
            style={{
              borderRadius: 999,
              border: scope === tab.id ? "1px solid #111827" : "1px solid #E5E7EB",
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

      <Step3Titles config={liveConfig} scope={scope} readOnly={readOnly} />
      <Step3AuditResults
        config={liveConfig}
        auditStatus={auditStatus}
        appEnabled={appEnabled}
        scope={scope}
        readOnly={readOnly}
      />
    </s-section>
  );
}
