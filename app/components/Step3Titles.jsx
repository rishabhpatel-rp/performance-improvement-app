/* eslint-disable react/prop-types */
import { useState } from "react";
import { useFetcher } from "react-router";

/**
 * Step 3 — Audit Results. Shows the two arrays produced by the one-time
 * auto-audit (script_1): the audited defer/blocklist array that feeds
 * script_2, and the audited off-screen CSS selectors that feed script_3.
 * Both are editable and auto-save on blur (one line per entry).
 *
 * Script title labels (config.scriptTitles) are no longer edited here —
 * they remain purely cosmetic labels for the Step 2 toggles.
 */
export default function Step3Titles({ config }) {
  const deferFetcher = useFetcher();
  const hideFetcher = useFetcher();

  const [deferText, setDeferText] = useState(
    (config.auditDeferArray || []).join("\n"),
  );
  const [hideText, setHideText] = useState(
    (config.auditHideSelectors || []).join("\n"),
  );

  const linesFrom = (text) =>
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

  const saveDefer = () => {
    deferFetcher.submit(
      {
        intent: "save-audit-defer",
        auditDeferArray: JSON.stringify(linesFrom(deferText)),
      },
      { method: "POST" },
    );
  };

  const saveHide = () => {
    hideFetcher.submit(
      {
        intent: "save-audit-hide",
        auditHideSelectors: JSON.stringify(linesFrom(hideText)),
      },
      { method: "POST" },
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

        <div style={{ padding: "16px 0", borderBottom: "1px solid #E5E8EC" }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#222222",
              marginBottom: 8,
            }}
          >
            Defer Script Array
          </div>
          <s-text-area
            label=""
            placeholder="One script name or host per line, e.g. clarity, klaviyo.com..."
            value={deferText}
            rows={6}
            onChange={(e) => setDeferText(e.target.value)}
            onBlur={saveDefer}
          />
        </div>

        <div style={{ padding: "16px 0" }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 700,
              color: "#222222",
              marginBottom: 8,
            }}
          >
            Hide CSS Classes
          </div>
          <s-text-area
            label=""
            placeholder="One CSS selector per line, e.g. .footer-banner..."
            value={hideText}
            rows={6}
            onChange={(e) => setHideText(e.target.value)}
            onBlur={saveHide}
          />
        </div>
      </s-stack>
    </s-section>
  );
}
