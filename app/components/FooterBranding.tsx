/**
 * Footer branding component matching Desing_plan.md: rocket icon,
 * "PERFORMANCE APP" brand, tagline, and legal/support links.
 */
const TERMS_URL = "https://www.brainvire.com/terms-of-use/";
const PRIVACY_URL = "https://www.brainvire.com/privacy-policy/";
const SUPPORT_EMAIL = "shopify@brainvire.com";

const linkStyle = {
  fontSize: 12,
  color: "#2B6CB0",
  textDecoration: "none",
};

export default function FooterBranding() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: 40,
        gap: 8,
      }}
    >
      {/* Brand logo + name */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <img
          src="/PagePulse-logo-Icon.jpg"
          alt=""
          style={{ width: 36, height: 36, objectFit: "cover", borderRadius: "100%" }}
        />
        <span
          style={{
            fontSize: 20,
            fontWeight: 700,
            color: "#4A5568",
            letterSpacing: 1,
          }}
        >
          PERFORMANCE APP
        </span>
      </div>

      {/* Tagline */}
      <span
        style={{
          fontSize: 11,
          color: "#718096",
          textTransform: "uppercase",
          letterSpacing: 1.5,
        }}
      >
        Boost your store performance
      </span>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 4,
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          Privacy Policy
        </a>
        <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
          Terms of use
        </a>
      </div>

      <a href={`mailto:${SUPPORT_EMAIL}`} style={linkStyle}>
        Support Email: {SUPPORT_EMAIL}
      </a>
    </div>
  );
}
