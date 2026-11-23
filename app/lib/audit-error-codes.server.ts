const TRANSIENT = new Set([
  "BROWSER_CRASH",
  "TIMEOUT",
  "NAV_TIMEOUT",
  "SHOPIFY_AUTH",
  "UNKNOWN",
  "AUDIT_RUN_TIMEOUT",
]);

export function classifyAuditFailure(err: unknown): {
  code: string;
  detail: string;
  transient: boolean;
} {
  const detail = err instanceof Error ? err.message : String(err);
  const name = err instanceof Error ? err.name : "";

  if (name === "AuditBlockedError") {
    const code =
      detail.includes("PASSWORD") && detail.includes("no storefront")
        ? "PASSWORD_REQUIRED"
        : detail.includes("incorrect")
          ? "PASSWORD_INCORRECT"
          : "PASSWORD_REQUIRED";
    return { code, detail, transient: false };
  }
  if (name === "AuditRunCancelledError") {
    return { code: "CANCELLED", detail, transient: false };
  }
  if (name === "AuditRunTimeoutError") {
    return { code: "AUDIT_RUN_TIMEOUT", detail, transient: true };
  }

  const lower = detail.toLowerCase();
  let code = "UNKNOWN";
  if (/target closed|browser.*closed|crashed/i.test(lower)) code = "BROWSER_CRASH";
  else if (/timeout|timed out/i.test(lower)) code = "NAV_TIMEOUT";
  else if (/session|token|401|shopify.*auth/i.test(lower)) code = "SHOPIFY_AUTH";
  else if (detail === "AUDIT_STOPPED_BY_USER") code = "AUDIT_STOPPED_BY_USER";
  return { code, detail, transient: TRANSIENT.has(code) };
}

export function retryBackoffMs(attempt: number): number {
  const base = 30_000;
  return Math.min(base * 2 ** Math.max(0, attempt - 1), 10 * 60_000);
}
