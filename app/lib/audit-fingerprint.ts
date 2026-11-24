/**
 * Sprint 6 — incremental re-audit fingerprint helpers.
 * Pure functions; no Playwright/Prisma imports.
 */
import { createHash } from "node:crypto";

/** Stable SHA-256 of sorted unique script tokens / URLs. */
export function buildScriptListFingerprint(tokens: Iterable<string>): string {
  const sorted = [...new Set([...tokens].map((t) => String(t).trim()).filter(Boolean))].sort();
  return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex");
}

/** Extract fingerprint previously stored on an audit report (if any). */
export function fingerprintFromReport(report: {
  auditRunMeta?: { scriptListFingerprint?: string };
  deferArray?: string[];
  neverDefer?: string[];
  funnel?: Array<{ candidates?: number }>;
  scriptInventory?: { byToken?: Array<{ token: string }> };
}): string | null {
  const stored = report.auditRunMeta?.scriptListFingerprint;
  if (stored && /^[a-f0-9]{64}$/i.test(stored)) return stored.toLowerCase();

  const tokens: string[] = [];
  if (Array.isArray(report.deferArray)) tokens.push(...report.deferArray);
  if (Array.isArray(report.neverDefer)) tokens.push(...report.neverDefer);
  for (const entry of report.scriptInventory?.byToken ?? []) {
    if (entry?.token) tokens.push(entry.token);
  }
  if (tokens.length === 0) return null;
  return buildScriptListFingerprint(tokens);
}
