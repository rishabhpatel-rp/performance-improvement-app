/**
 * Sprint 6 — incremental re-audit: skip full Chromium measure when the
 * storefront script list fingerprint matches the previous completed report.
 */
import type { Browser } from "playwright";
import { withBrowser } from "./audit-browser.ts";
import type { DiscoveredPages, HiddenAuditResult } from "./audit-core.ts";
import { buildScriptListFingerprint, fingerprintFromReport } from "./audit-fingerprint.ts";
import { loadLatestAuditReport } from "./audit-report-summary.server.ts";
import { logAuditEvent } from "./audit-logging.server.ts";
import { measurePage } from "./audit-measure.ts";
import { getEnv } from "./env.server.ts";
import { logger } from "./logger.ts";

async function harvestScriptFingerprint(
  browser: Browser,
  urls: string[],
  password: string | undefined,
  isStopped?: () => boolean | Promise<boolean>,
): Promise<string> {
  const tokens = new Set<string>();
  const pageParallel = Math.max(1, getEnv().AUDIT_MAX_PARALLEL_PAGES);
  for (let bi = 0; bi < urls.length; bi += pageParallel) {
    if (isStopped && (await isStopped())) break;
    const batch = urls.slice(bi, bi + pageParallel);
    const settled = await Promise.allSettled(
      batch.map(async (url) => {
        const m = await measurePage(
          browser,
          url,
          password,
          true, // harvestOnly — names only
          () => isStopped?.() === true,
          false, // collectLongTask
          false, // isHomePage (harvest path — scroll unused)
        );
        try {
          for (const t of m.acc.p ?? []) tokens.add(t);
          for (const t of m.acc.neverDefer ?? []) tokens.add(t);
          for (const t of m.acc.noise ?? []) tokens.add(t);
          for (const t of m.acc.selfScripts ?? []) tokens.add(t);
        } finally {
          await m.context.close().catch(() => {});
        }
      }),
    );
    const failed = settled.find((r) => r.status === "rejected");
    if (failed && failed.status === "rejected") throw failed.reason;
  }
  return buildScriptListFingerprint(tokens);
}

/**
 * Returns a reused prior report when the live script fingerprint matches,
 * otherwise null (caller runs a full audit).
 */
export async function tryIncrementalReaudit(opts: {
  shopDomain: string;
  pages: DiscoveredPages;
  password?: string;
  isStopped?: () => boolean | Promise<boolean>;
}): Promise<HiddenAuditResult | null> {
  if (!getEnv().AUDIT_INCREMENTAL_REAUDIT) return null;

  const prior = await loadLatestAuditReport(opts.shopDomain);
  if (!prior) return null;
  const priorFp = fingerprintFromReport(prior);
  if (!priorFp) return null;

  const urls = [
    opts.pages.home,
    opts.pages.plp,
    opts.pages.pdp,
    ...(opts.pages.extras ?? []),
  ].filter((u): u is string => Boolean(u));
  if (urls.length === 0) return null;

  const liveFp = await withBrowser((browser) =>
    harvestScriptFingerprint(browser, urls, opts.password, opts.isStopped),
  );

  if (liveFp !== priorFp) {
    logger.info(`[Audit] Incremental re-audit miss for ${opts.shopDomain} (fingerprint changed)`);
    logAuditEvent("audit_obs", {
      shop: opts.shopDomain,
      eventDetail: "incremental_miss",
      priorFingerprint: priorFp.slice(0, 16),
      liveFingerprint: liveFp.slice(0, 16),
    });
    return null;
  }

  logger.info(`[Audit] Incremental re-audit hit for ${opts.shopDomain} — reusing prior report`);
  logAuditEvent("audit_obs", {
    shop: opts.shopDomain,
    eventDetail: "incremental_hit",
    fingerprint: priorFp.slice(0, 16),
  });

  return {
    ...prior,
    completedAt: new Date().toISOString(),
    auditRunMeta: {
      wallTimeMs: prior.auditRunMeta?.wallTimeMs ?? 0,
      passesRun: 0,
      passesPlanned: prior.auditRunMeta?.passesPlanned ?? 3,
      earlyPassTerminated: prior.auditRunMeta?.earlyPassTerminated,
      scriptListFingerprint: priorFp,
      incrementalCacheHit: true,
      chromiumVersion: prior.auditRunMeta?.chromiumVersion,
    },
    warnings: [
      ...(prior.warnings ?? []),
      "incremental-reaudit: script list unchanged; reused prior audit report",
    ],
  };
}
