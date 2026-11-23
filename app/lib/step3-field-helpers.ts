/* eslint-disable @typescript-eslint/no-explicit-any -- legacy field config */
const SCOPE_SUFFIX = {
  global: "Global",
  home: "Home",
  collection: "Collection",
  product: "Product",
};

export function fieldsForScope(scope: string) {
  const s = (SCOPE_SUFFIX as Record<string, string>)[scope] || "Global";
  return [
    {
      key: `auditDefer${s}`,
      toggleField: "auditDeferArray",
      enabledKey: "auditDeferArrayEnabled",
      delayKey: null,
      label: "Defer Heavy Scripts",
      hint: "Add the script names you want to defer till interaction.",
      placeholder: '["jquery.min.js","cdn.clarity"]',
    },
    {
      key: `auditHide${s}`,
      toggleField: "auditHideSelectors",
      enabledKey: "auditHideSelectorsEnabled",
      delayKey: null,
      label: "Hide Lastfold Classes",
      hint: "Add the class names you want to hide till interaction.",
      placeholder: '["#footer-links",".product-grid > :nth-child(n+5)"]',
    },
    {
      key: `firstUserDelayScripts${s}`,
      toggleField: "firstUserDelayScripts",
      enabledKey: "firstUserDelayScriptsEnabled",
      delayKey: `firstUserDelayMs${s}`,
      delayDefault: 12000,
      label: "Delay Scripts for First User",
      hint: "Add the script names you want to delay for first-time visitors.",
      placeholder: '["wpm","gtm"]',
    },
    {
      key: `staticDeferDefaults${s}`,
      toggleField: "staticDeferDefaults",
      enabledKey: "staticDeferDefaultsEnabled",
      delayKey: `everyTimeDelayMs${s}`,
      delayDefault: 6000,
      label: "Delay Scripts",
      hint: "Add the script names you want to delay on every page load.",
      placeholder: '["wpm","gtm"]',
    },
  ];
}

export function toEditable(value: any) {
  const arr = Array.isArray(value) ? value : [];
  return JSON.stringify(arr, null, 2);
}

export function validateArray(text: any) {
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
