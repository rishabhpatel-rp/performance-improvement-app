/** Merchant-facing copy for StoreConfig.auditError / job errorCode. */

const COPY: Record<string, string> = {
  PASSWORD_REQUIRED:
    "Your store is password protected. Enter the storefront password below and we'll scan again.",
  PASSWORD_INCORRECT: "The saved password didn't work. Update it below and we'll scan again.",
  QUEUE_TIMEOUT:
    "The audit timed out waiting to start. Please try again — if this keeps happening, contact support.",
  QUEUE_FULL: "The audit queue is full right now. Try again in a little while.",
  COOLDOWN:
    "An audit was run recently for this store. Please wait a few minutes before starting another.",
  BROWSER_CRASH:
    "The browser used for the scan stopped unexpectedly. We're retrying when possible.",
  NAV_TIMEOUT:
    "A page took too long to load during the scan. Check that your storefront is reachable.",
  SHOPIFY_AUTH:
    "We lost access to your store while scanning. Open the app again and retry the audit.",
  AUDIT_RUN_TIMEOUT:
    "This audit took longer than the allowed time limit. Try again with fewer custom pages.",
  STALE_RUNNING: "The audit stopped responding and was marked failed. Please start a new audit.",
  WORKER_LOST:
    "The audit was interrupted by a server restart. It will retry automatically when possible.",
  UNKNOWN: "The audit could not finish. Please try again or contact support if this continues.",
  CANCELLED: "The audit was stopped.",
  AUDIT_STOPPED_BY_USER: "The audit was stopped.",
  already_running: "An audit is already in progress for this store.",
};

export function auditErrorUserMessage(code: string | null | undefined): string | null {
  if (!code || typeof code !== "string") return null;
  return COPY[code] ?? COPY.UNKNOWN;
}
