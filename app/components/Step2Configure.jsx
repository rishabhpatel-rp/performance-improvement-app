/* eslint-disable react/prop-types */
import Step3Titles from "./Step3Titles";

/**
 * Step 2 — manual list editors when audit is complete (audit report on Step 3).
 */
export default function Step2Configure({
  config,
  appEnabled,
  auditComplete = false,
  configLoading = false,
}) {
  const liveConfig = config;
  const showDisabledBanner = !liveConfig.appEnabled;
  const showEditors =
    liveConfig.appEnabled && (auditComplete || liveConfig.auditComplete);

  return (
    <s-section heading="Step 2: Configure">
      {showDisabledBanner && (
        <s-stack direction="block" gap="base">
          <s-banner tone="info">Enable the app in Step 1 first.</s-banner>
        </s-stack>
      )}

      {liveConfig.appEnabled && !showEditors && (
        <s-stack direction="block" gap="base">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <s-spinner size="small" />
            <s-text tone="subdued">
              {configLoading
                ? "Refreshing configuration…"
                : "Waiting for the audit to finish. You can configure scripts here once the scan completes."}
            </s-text>
          </div>
        </s-stack>
      )}

      {showEditors && (
        <>
          <s-divider />
          <Step3Titles
            config={liveConfig}
            appEnabled={appEnabled ?? liveConfig.appEnabled}
          />
        </>
      )}
    </s-section>
  );
}
