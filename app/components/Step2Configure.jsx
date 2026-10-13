/* eslint-disable react/prop-types */
import { useFetcher } from "react-router";
import { PREDEFINED_SCRIPTS } from "../lib/scripts";
import Step3Titles from "./Step3Titles";

const FIELD_BY_INDEX = ["script1Enabled", "script2Enabled", "script3Enabled"];

/**
 * Step 2 — predefined script toggles only (audit UI lives on Step 3).
 */
export default function Step2Configure({ config, appEnabled }) {
  const fetcher = useFetcher();

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

      {liveConfig.appEnabled && liveConfig.auditComplete && (
        <>
          <s-divider />
          <Step3Titles config={liveConfig} appEnabled={appEnabled ?? liveConfig.appEnabled} />
        </>
      )}
    </s-section>
  );
}
