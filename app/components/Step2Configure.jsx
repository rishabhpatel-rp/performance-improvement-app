/* eslint-disable react/prop-types */
import { useFetcher } from "react-router";
import { PREDEFINED_SCRIPTS } from "../lib/scripts";

const FIELD_BY_INDEX = ["script1Enabled", "script2Enabled", "script3Enabled"];

/**
 * Step 2 — one toggle per predefined script, labeled with the current title
 * from config.scriptTitles[i] (falling back to the script's default name).
 * Toggles are disabled while the app itself is off.
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
          Choose which performance scripts should run on your storefront.
          Each one injects only into the page &lt;head&gt;.
        </s-paragraph>

        {!liveConfig.appEnabled && (
          <s-banner tone="info">Enable the app in Step 1 first.</s-banner>
        )}

        {PREDEFINED_SCRIPTS.map((script, index) => (
          <s-switch
            key={script.id}
            label={liveConfig.scriptTitles[index] || script.name}
            checked={liveConfig[FIELD_BY_INDEX[index]]}
            disabled={!liveConfig.appEnabled}
            onChange={(e) => handleToggle(index, e.target.checked)}
          />
        ))}
      </s-stack>
    </s-section>
  );
}
