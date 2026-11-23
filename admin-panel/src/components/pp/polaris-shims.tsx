export function PpBanner({
  tone,
  children,
  style,
}: {
  tone: "info" | "warning" | "critical";
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className={`pp-banner pp-banner--${tone}`} style={style}>
      {children}
    </div>
  );
}

export function PpSwitch({
  checked,
  disabled,
  onChange,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
}) {
  return (
    <label className="pp-switch" aria-label={label || "Toggle"}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="pp-switch__track" />
    </label>
  );
}

export function PpButton({
  children,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button type="button" className="pp-btn-secondary-sm" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

export function PpTextArea({
  value,
  placeholder,
  disabled,
  onChange,
  rows = 6,
}: {
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  rows?: number;
}) {
  return (
    <textarea
      className="pp-polaris-textarea"
      rows={rows}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function PpSpinner() {
  return (
    <span
      style={{
        display: "inline-block",
        width: 16,
        height: 16,
        border: "2px solid #C9CCCF",
        borderTopColor: "#202223",
        borderRadius: "50%",
        animation: "pp-spin 0.7s linear infinite",
      }}
    />
  );
}
