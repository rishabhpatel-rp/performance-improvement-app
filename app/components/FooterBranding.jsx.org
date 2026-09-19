/* eslint-disable react/prop-types */
/**
 * Footer branding component matching Desing_plan.md: rocket icon,
 * "PERFORMANCE APP" brand, tagline, and terms link.
 */
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
      {/* Rocket icon + brand name */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: "50%",
            backgroundColor: "#4A5568",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 18,
          }}
        >
          🚀
        </div>
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

      {/* Terms link */}
      <span
        role="link"
        tabIndex={0}
        onClick={() => {}}
        onKeyDown={() => {}}
        style={{
          fontSize: 12,
          color: "#2B6CB0",
          textDecoration: "none",
          marginTop: 4,
        }}
      >
        Terms of use
      </span>
    </div>
  );
}
