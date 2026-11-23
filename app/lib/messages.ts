/** Merchant-facing copy lives here so tone stays consistent and can be
 *  reviewed in one place. No developer codes are shown to merchants. */

export const messages = {
  step1Heading: "Make your store faster, starting now",
  step1Intro:
    "We're committed to helping Shopify merchants build faster, better-performing stores.",
  step2Heading: "Scripts",
  continue: "Continue",
  back: "Back",
  retry: "Retry",
  saving: "Saving…",
  saved: "Saved",
  copyDiagnostics: "Copy diagnostics",
  supportIntro:
    "Something went wrong. Try again — if it keeps happening, copy the details and send them to support.",
  supportHelp: "Visit the help centre",
  auditQueued: "Waiting for your scan to start…",
  auditDiscovering: "Finding the pages to scan…",
  auditRunning: "Scanning your store now…",
  auditComplete: "Scan complete. Review the recommendations below.",
  auditFailed: "We couldn't finish the scan. Try again or check the details below.",
  passwordRequired:
    "Your store is password protected. Enter the storefront password below and we'll scan again.",
  passwordIncorrect: "The saved password didn't work. Update it below and we'll scan again.",
  extensionRequired: "The app embed isn't enabled yet. Open the theme editor to turn it on.",
  urlWeekExample: "Choose the collection and product pages to test.",
  urlInvalid: "That doesn't look like a valid URL. Enter a page on your store.",
  urlOwnStore: "Use a page from your own store.",
  readOnly: "This store is configured by the PagePulse team. Changes here are disabled.",
  unsavedChanges: "You have unsaved changes. Leave this page without saving?",
  delayWarning:
    "Delaying scripts can change how your storefront behaves. You can undo this at any time.",
  describeDisabled: "Turn on the app and finish the scan to unlock this step.",
  autMultisite: "Made faster with PagePulse",
} as const;

export type MessageKey = keyof typeof messages;

export function message(key: MessageKey): string {
  return messages[key];
}
