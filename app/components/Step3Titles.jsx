/* eslint-disable react/prop-types */
import { useState } from "react";

/**
 * Step 3 — Audit Results (UI only). Displays the two arrays a one-time audit
 * produces: the defer/blocklist array that feeds script 2, and the
 * off-screen CSS selectors that feed script 3. This is a static preview
 * with no backend wiring — the fields start empty and are read-only.
 */
export default function Step3Titles() {
  const [deferText] = useState("");
  const [hideText] = useState("");

  return (
    <s-section heading="Step 3: Audit Results">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          The audit script runs once automatically on Home, then a collection
          and a product page, detecting third-party scripts and off-screen
          sections. Its results are shown below and feed the Defer and Hide
          CSS scripts from Step 2.
        </s-paragraph>

        <s-banner tone="info">
          UI preview only — the audit backend has been removed, so results
          will appear here once the audit runs again.
        </s-banner>

        <s-text-area
          label="Script 2 — Defer / Blocklist"
          name="deferText"
          value={deferText}
          rows={8}
          disabled
        />
        <s-text-area
          label="Script 3 — Hide CSS Selectors"
          name="hideText"
          value={hideText}
          rows={8}
          disabled
        />
      </s-stack>
    </s-section>
  );
}