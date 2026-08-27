/* eslint-disable react/prop-types */
import { useFetcher } from "react-router";

/**
 * Step 1 — single toggle: "Enable Performance Improvement App" (app_enabled).
 * Submits immediately via useFetcher (intent: "toggle-app") — does not wait
 * for a later save step.
 */
export default function Step1Activate({ config }) {
  const fetcher = useFetcher();
  // Priority: action response > optimistic formData > loader data
  const appEnabled =
    fetcher.data?.config?.appEnabled ??
    (fetcher.formData
      ? fetcher.formData.get("appEnabled") === "true"
      : config.appEnabled);

  const handleToggle = (checked) => {
    fetcher.submit(
      { intent: "toggle-app", appEnabled: String(checked) },
      { method: "POST" },
    );
  };

  return (
    <s-section heading="Step 1: Activate">
      <s-stack direction="block" gap="base">
        {/* Header */}
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#222222",
              margin: 0,
            }}
          >
            ⚡ Make your store faster, starting now
          </h2>
        </div>

        {/* Green callout banner */}
        <div
          style={{
            margin: "16px auto",
            maxWidth: "90%",
            padding: "16px 20px",
            backgroundColor: "#E8F8F0",
            borderTop: "4px solid #00C853",
            borderRadius: 4,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              backgroundColor: "#00C853",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            ✔
          </div>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#1E3A2B",
                marginBottom: 4,
              }}
            >
              A powerful speed app without the expensive price tag?
            </div>
            <div style={{ fontSize: 13, color: "#4A5568" }}>
              We&apos;re committed to helping Shopify merchants build faster,
              better-performing stores.
            </div>
          </div>
        </div>

        {/* Rocket illustration */}
        <div style={{ textAlign: "center", margin: "24px 0" }}>
          <div style={{ fontSize: 64 }}>🚀</div>
        </div>

        {/* Toggle instruction */}
        <div style={{ textAlign: "center", fontSize: 16, color: "#333333" }}>
          Improve loading speed, enhance the customer experience, and boost
          conversions — just turn this ON 👇
        </div>

        {/* Toggle switch */}
        <div style={{ display: "flex", justifyContent: "center", padding: 8 }}>
          <s-switch
            label=""
            checked={appEnabled}
            onChange={(e) => handleToggle(e.target.checked)}
          />
        </div>
      </s-stack>
    </s-section>
  );
}
