/* Static Step 1 intro: heading and reassurance callout. */
import { messages } from "../../lib/messages.ts";
export default function Step1Header() {
  return (
    <>
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
          ⚡ {messages.step1Heading}
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
            We&apos;re committed to helping Shopify merchants build faster, better-performing
            stores.
          </div>
        </div>
      </div>
    </>
  );
}
