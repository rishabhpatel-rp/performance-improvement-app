/** Mirrors PagePulse `app/components/Step3Titles.jsx` field definitions. */
export const AUDIT_ARRAY_FIELDS = [
  {
    key: "auditDeferArray",
    enabledKey: "auditDeferArrayEnabled",
    delayKey: null as string | null,
    delayDefault: 0,
    label: "Defer Heavy Scripts",
    hint: "Script URL fragments deferred until visitor interaction.",
    placeholder: '["jquery.min.js","cdn.clarity"]',
  },
  {
    key: "auditHideSelectors",
    enabledKey: "auditHideSelectorsEnabled",
    delayKey: null,
    delayDefault: 0,
    label: "Hide Lastfold Classes",
    hint: "CSS selectors hidden until interaction.",
    placeholder: '["#footer-links",".product-grid > :nth-child(n+5)"]',
  },
  {
    key: "firstUserDelayScripts",
    enabledKey: "firstUserDelayScriptsEnabled",
    delayKey: "firstUserDelayMs",
    delayDefault: 12000,
    label: "Delay Scripts for First User",
    hint: "Scripts delayed for first-time visitors only.",
    placeholder: '["wpm","gtm"]',
  },
  {
    key: "staticDeferDefaults",
    enabledKey: "staticDeferDefaultsEnabled",
    delayKey: "everyTimeDelayMs",
    delayDefault: 6000,
    label: "Delay Scripts",
    hint: "Scripts delayed on every page load.",
    placeholder: '["wpm","gtm"]',
  },
] as const;

export type AuditArrayFieldKey = (typeof AUDIT_ARRAY_FIELDS)[number]["key"];

const PRESERVED_BY_KEY: Record<AuditArrayFieldKey, string> = {
  auditDeferArray: "auditDeferArrayPreserved",
  auditHideSelectors: "auditHideSelectorsPreserved",
  staticDeferDefaults: "staticDeferDefaultsPreserved",
  firstUserDelayScripts: "firstUserDelayScriptsPreserved",
};

/** Same rules as PagePulse `readStringArray` (+ legacy JSON string column values). */
export function readJsonStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((x): x is string => typeof x === "string");
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((x): x is string => typeof x === "string");
      }
    } catch {
      /* ignore */
    }
  }
  return [];
}

export function toEditableArray(value: unknown): string {
  return JSON.stringify(readJsonStringArray(value), null, 2);
}

/** Active array for editing: when toggle is off, show preserved snapshot (merchant UI hides it). */
export function configArrayForDisplay(
  config: Record<string, unknown> | null | undefined,
  fieldKey: AuditArrayFieldKey,
  enabledKey: string,
): string[] {
  if (!config) return [];
  const enabled = config[enabledKey] !== false;
  const active = readJsonStringArray(config[fieldKey]);
  if (enabled) return active;
  const preserved = readJsonStringArray(config[PRESERVED_BY_KEY[fieldKey]]);
  return preserved.length > 0 ? preserved : active;
}

export function validateArrayJson(text: string): {
  valid: boolean;
  value: string[] | null;
  error: string;
} {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value) && value.every((x) => typeof x === "string")) {
      return { valid: true, value, error: "" };
    }
    return {
      valid: false,
      value: null,
      error: 'Must be a JSON array of strings, e.g. ["a","b"].',
    };
  } catch {
    return { valid: false, value: null, error: "Invalid JSON." };
  }
}
