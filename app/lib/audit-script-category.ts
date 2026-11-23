/** H-1: operator-facing script category (payments, analytics, …). */

export type ScriptRiskCategory =
  | "payments"
  | "consent"
  | "analytics"
  | "chat"
  | "ab-testing"
  | "social-proof"
  | "retargeting"
  | "ui-critical"
  | "theme"
  | "shopify-core"
  | "unknown";

const RISK_RULES: Array<{ test: RegExp; label: ScriptRiskCategory }> = [
  { test: /stripe|paypal|klarna|affirm|afterpay|sezzle|square/i, label: "payments" },
  { test: /onetrust|cookiebot|consent|gdpr|cmp|trustarc|osano/i, label: "consent" },
  {
    test: /google-analytics|gtag|fbq|facebook\.net|klaviyo|tiktok|pinterest|segment|mixpanel|amplitude/i,
    label: "analytics",
  },
  { test: /intercom|drift|crisp|freshchat|tidio|zendesk|hubspot.*widget/i, label: "chat" },
  { test: /optimizely|vwo|ab-test|abtasty|google-optimize/i, label: "ab-testing" },
  { test: /yotpo|okendo|reviews\.io|stamped|trustpilot|loox|judgeme/i, label: "social-proof" },
  { test: /criteo|adroll|taboola|outbrain|retarget|doubleclick/i, label: "retargeting" },
  { test: /storefront|chunk\./i, label: "shopify-core" },
  { test: /^assets\//i, label: "theme" },
];

export function classifyScriptCategory(token: string, domain?: string): ScriptRiskCategory {
  const hay = `${token} ${domain ?? ""}`;
  for (const rule of RISK_RULES) {
    if (rule.test.test(hay)) return rule.label;
  }
  return "unknown";
}
