/* eslint-disable react/prop-types */
import { useFetcher } from "react-router";
import { PREDEFINED_SCRIPTS } from "../lib/scripts";

const FIELD_BY_INDEX = ["script1Enabled", "script2Enabled", "script3Enabled"];

// Short role description shown under each toggle (Implementation Plan 4,
// Task 4.3) — clarifies what each script actually does now that script_1
// is a one-time audit feeding script_2/script_3.
const DESCRIPTION_BY_INDEX = [
  "Runs once automatically on Home, then a collection and a product page, " +
    "to detect third-party scripts and off-screen sections. Turning this " +
    "off removes it from <head> immediately. Feeds the Defer and Hide CSS " +
    "scripts below.",
  "Delays loading of the scripts found by the audit (or the built-in " +
    "default list, if no audit has completed yet) until the shopper " +
    "interacts with the page.",
  "Hides the off-screen sections found by the audit via CSS, using the " +
    "selectors shown in Step 3.",
];

/**
 * Step 2 — one toggle per predefined script (Audit / Defer / Hide CSS),
 * labeled with the current title from config.scriptTitles[i] (falling back
 * to the script's default name, purely cosmetic). Toggles are disabled
 * while the app itself is off.
 */
export default function Step2Configure({ config }) {
  const fetcher = useFetcher();

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

  return (
    <s-section heading="Step 2: Configure">
      <s-stack direction="block" gap="base">
        <s-paragraph>
          Choose which performance scripts should run on your storefront. Each
          one injects only into the page &lt;head&gt;.
        </s-paragraph>

        {!liveConfig.appEnabled && (
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
            <s-text tone="subdued">{DESCRIPTION_BY_INDEX[index]}</s-text>
          </s-stack>
        ))}
      </s-stack>
    </s-section>
  );
}
