/* eslint-disable react/prop-types */
import { useState } from "react";
import { useFetcher } from "react-router";
import { PREDEFINED_SCRIPTS } from "../lib/scripts";
import Step3Titles from "./Step3Titles";
import Step3AuditResults from "./Step3AuditResults";

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
export default function Step2Configure({ config, auditStatus, appEnabled }) {
  const fetcher = useFetcher();
  const [scope, setScope] = useState("global");

  // Merge action response into config for fresh state after toggle
  const liveConfig = fetcher.data?.config
    ? { ...config, ...fetcher.data.config }
    : config;

  const handleToggle = (index, checked) => {
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
          {showDisabledBanner && (
            <s-banner tone="info">Enable the app in Step 1 first.</s-banner>
          )}

          {PREDEFINED_SCRIPTS.map((script, index) => (
            <s-stack key={script.id} direction="block" gap="tight">
              <s-switch
                label={liveConfig.scriptTitles[index] || script.name}
                checked={liveConfig[FIELD_BY_INDEX[index]]}
                disabled={!liveConfig.appEnabled}
                onChange={(e) => handleToggle(index, e.target.checked)}
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

      <Step3Titles config={liveConfig} scope={scope} />
      <Step3AuditResults
        config={liveConfig}
        auditStatus={auditStatus}
        appEnabled={appEnabled}
        scope={scope}
      />
    </s-section>
  );
}
