/** Field-level input schemas for merchant intents. Shared by the dashboard action
 *  and the admin internal write route so both reject the same malformed input. */

const BOOLEAN_FIELDS = new Set(["true", "false"]);
const SCOPES = new Set(["global", "home", "collection", "product"]);

export const INTENT_SCHEMAS: Record<string, Record<string, (v: unknown) => string | null>> = {
  "toggle-app": {
    appEnabled: (v) => (BOOLEAN_FIELDS.has(String(v)) ? null : "Expected true or false."),
  },
  "start-audit": {},
  "stop-audit": {},
  "select-theme": {
    themeId: (v) => (typeof v === "string" && v.trim() ? null : "Choose a theme."),
  },
  "toggle-script": {
    scriptIndex: (v) => {
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 && n <= 2 ? null : "Invalid script slot.";
    },
    enabled: (v) => (BOOLEAN_FIELDS.has(String(v)) ? null : "Expected true or false."),
  },
  "toggle-audit-field": {
    field: (v) => (typeof v === "string" && v.trim() ? null : "Invalid field."),
    enabled: (v) => (BOOLEAN_FIELDS.has(String(v)) ? null : "Expected true or false."),
  },
  "save-audit-arrays": {
    scope: (v) => (SCOPES.has(String(v || "global")) ? null : "Invalid tab."),
  },
  "script-token-action": {
    token: (v) => (typeof v === "string" && v.trim() ? null : "Missing script token."),
    action: (v) => (typeof v === "string" && v.trim() ? null : "Invalid action."),
    scope: (v) => (SCOPES.has(String(v || "global")) ? null : "Invalid tab."),
  },
  "save-storefront-password": {
    storefrontPassword: (v) =>
      typeof v === "string" && v.length <= 512 ? null : "Password is too long.",
  },
  "save-custom-page-urls": {
    customPlpUrl: (v) => (typeof v === "string" ? null : "Invalid collection page."),
    customPdpUrl: (v) => (typeof v === "string" ? null : "Invalid product page."),
  },
  "maybe-first-activation": {},
};

export function validateIntent(
  intent: string,
  formData: FormData,
): { ok: boolean; errors: Record<string, string> } {
  const schema = INTENT_SCHEMAS[intent];
  if (!schema) return { ok: false, errors: { intent: "Unknown intent." } };
  const errors: Record<string, string> = {};
  for (const [field, check] of Object.entries(schema)) {
    const value: unknown = formData.get(field);
    const message = check(value);
    if (message) errors[field] = message;
  }
  return { ok: Object.keys(errors).length === 0, errors };
}
