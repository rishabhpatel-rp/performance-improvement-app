/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

export default function Step3Titles({ config, scripts, onScriptDataChange }) {
  const deferFetcher = useFetcher();
  const hideFetcher = useFetcher();

  const [deferText, setDeferText] = useState(
    (config.auditDeferArray || []).join("\n")
  );
  const [hideText, setHideText] = useState(
    (config.auditHideSelectors || []).join("\n")
  );

  const apiScripts = scripts?.success ? scripts.scripts : [];

  // Format the audit script code payload as plain text
  const auditScriptText = apiScripts.length > 0
    ? apiScripts.map((s) => `// ${s.name}\n${s.code}`).join("\n\n")
    : "";

  // Helper to send the absolute latest state to parent app._index.jsx
  const notifyParent = (latestDefer, latestHide) => {
    if (onScriptDataChange) {
      onScriptDataChange({
        auditScript: auditScriptText,
        deferScript: latestDefer,
        hiddenCss: latestHide,
      });
    }
  };

  // Sync initial and updated values automatically
  useEffect(() => {
    notifyParent(deferText, hideText);
  }, [auditScriptText, deferText, hideText]);

  const linesFrom = (text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const handleDeferChange = (e) => {
    const val = e.target.value ?? "";
    setDeferText(val);
    notifyParent(val, hideText);
  };

  const handleHideChange = (e) => {
    const val = e.target.value ?? "";
    setHideText(val);
    notifyParent(deferText, val);
  };

  const saveDefer = () => {
    deferFetcher.submit(
      {
        intent: "save-audit-defer",
        auditDeferArray: JSON.stringify(linesFrom(deferText)),
      },
      { method: "POST" }
    );
  };

  const saveHide = () => {
    hideFetcher.submit(
      {
        intent: "save-audit-hide",
        auditHideSelectors: JSON.stringify(linesFrom(hideText)),
      },
      { method: "POST" }
    );
  };

  return (
    <s-section heading="Step 3: Audit Results">
      <s-stack direction="block" gap="loose">
        <s-paragraph>
          The audit script runs once automatically and detects your Home,
          collection, and product pages. Its results appear below — the defer
          array feeds the Defer Script and the hide selectors feed the Hide CSS
          script. You can also edit these lists by hand.
        </s-paragraph>

        {!config.auditComplete && (
          <s-banner tone="info">
            The one-time audit hasn&apos;t finished yet. Results will appear
            here automatically once a storefront visit completes it. Toggling
            the app off then on again re-runs the audit.
          </s-banner>
        )}

        {/* --- Per-script payloads fetched from the Node API --- */}
        {apiScripts.length > 0 && (
          <div style={{ padding: "16px 0", borderBottom: "1px solid #E5E8EC" }}>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#222222",
                marginBottom: 8,
              }}
            >
              Script Payloads (from Node API)
            </div>

            {apiScripts.map((script) => (
              <div
                key={script.id}
                style={{ padding: "12px 0", borderBottom: "1px solid #F4F4F4" }}
              >
                <div
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    color: "#333",
                    marginBottom: 6,
                  }}
                >
                  {script.name}
                  <span
                    style={{
                      marginLeft: 8,
                      fontSize: 12,
                      fontWeight: 400,
                      color: "#888",
                    }}
                  >
                    ({script.type})
                  </span>
                </div>
                <s-text-area
                  label=""
                  value={script.code}
                  rows={8}
                />
              </div>
            ))}
          </div>
        )}

      </s-stack>
    </s-section>
  );
}
