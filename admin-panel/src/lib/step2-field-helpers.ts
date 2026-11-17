import type { TemplateScope } from "@/lib/storefront-lists";
import { parseListText, readStringList } from "@/lib/storefront-lists";

const SCOPE_SUFFIX: Record<TemplateScope, string> = {
  global: "Global",
  home: "Home",
  collection: "Collection",
  product: "Product",
};

export type Step2FieldDef = {
  key: string;
  toggleField: string;
  enabledKey: string;
  delayKey: string | null;
  delayDefault?: number;
  listFamily: "defer" | "hide" | "first" | "every";
  label: string;
  hint: string;
  placeholder: string;
};

export function fieldsForScope(scope: TemplateScope): Step2FieldDef[] {
  const s = SCOPE_SUFFIX[scope] || "Global";
  return [
    {
      key: `auditDefer${s}`,
      toggleField: "auditDeferArray",
      enabledKey: "auditDeferArrayEnabled",
      delayKey: null,
      listFamily: "defer",
      label: "Defer Heavy Scripts",
      hint: "Add the script names you want to defer till interaction.",
      placeholder: '["jquery.min.js","cdn.clarity"]',
    },
    {
      key: `auditHide${s}`,
      toggleField: "auditHideSelectors",
      enabledKey: "auditHideSelectorsEnabled",
      delayKey: null,
      listFamily: "hide",
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
      listFamily: "first",
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
      listFamily: "every",
      label: "Delay Scripts",
      hint: "Add the script names you want to delay on every page load.",
      placeholder: '["wpm","gtm"]',
    },
  ];
}

/** Normalize DB JSON / legacy string columns for the textarea. */
export function toEditable(value: unknown): string {
  if (typeof value === "string" && value.trim().startsWith("[")) {
    const parsed = parseListText(value.trim());
    if (parsed.ok) return JSON.stringify(parsed.value, null, 2);
  }
  return JSON.stringify(readStringList(value), null, 2);
}

export function validateArray(text: string): {
  valid: boolean;
  value: string[] | null;
  error: string;
} {
  const parsed = parseListText(text);
  if (parsed.ok) return { valid: true, value: parsed.value, error: "" };
  return { valid: false, value: null, error: parsed.error };
}
