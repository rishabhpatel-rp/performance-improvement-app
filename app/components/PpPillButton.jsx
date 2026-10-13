/* eslint-disable react/prop-types */
/**
 * Shared pill control for PagePulse dashboard (tabs, wizard nav, saves).
 * Matches Step 3 audit UI so controls do not mix with default s-button chrome.
 */
export default function PpPillButton({
  children,
  active = false,
  variant = "default",
  disabled = false,
  type = "button",
  onClick,
  style = {},
}) {
  const isPrimary = variant === "primary" || (active && variant !== "ghost");
  const base = {
    padding: "8px 16px",
    borderRadius: 999,
    border: isPrimary ? "1px solid #111827" : "1px solid #E5E7EB",
    background: disabled ? "#F3F4F6" : isPrimary ? "#111827" : "#FFFFFF",
    color: disabled ? "#9CA3AF" : isPrimary ? "#FFFFFF" : "#374151",
    fontSize: 13,
    fontWeight: isPrimary ? 600 : 500,
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "background 0.2s ease, color 0.2s ease, border-color 0.2s ease",
    fontFamily: "inherit",
    lineHeight: 1.25,
    ...style,
  };

  return (
    <button type={type} disabled={disabled} onClick={onClick} style={base}>
      {children}
    </button>
  );
}
