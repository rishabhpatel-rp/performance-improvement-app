export function isThemeFilesExemptDenied(reason) {
  return /exemption from Shopify/i.test(reason);
}

export const THEME_HEAD_INJECT_STATUS = {
  NOT_ATTEMPTED: "not_attempted",
  SKIPPED: "skipped",
  INJECTED: "injected",
  EXEMPT_DENIED: "exempt_denied",
  ERROR: "error",
};
