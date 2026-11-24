/**
 * Single implementation of a full audit run (discover → scan → build script).
 * Used by the in-memory runner and by DB-queue workers.
 */
import prisma from "../db.server";
import {
  discoverPages,
  runHiddenAudit,
  describePages,
  AuditBlockedError,
  AuditRunTimeoutError,
} from "./audit.server";
import { saveAuditReport } from "./store-sync-audit.server";
import { listThemes, numericThemeId } from "./theme-embed.server";
import { resolveShopAdmin } from "./internal-shop-session.server.ts";
import { beginAuditRun, endAuditRun, isAuditRunCurrent } from "./audit-run-signal.server";
import { AuditRunCancelledError } from "./audit-cancel.ts";
import { touchAuditJobHeartbeat, reconcileStoreAfterJobEnd } from "./audit-queue-reconcile.server";
import { AUDIT_HEARTBEAT_INTERVAL_MS } from "./audit-lifecycle";
import { auditRunDeadlineMs } from "./audit-env.server";
import { classifyAuditFailure } from "./audit-error-codes.server";
import { logAuditEvent } from "./audit-logging.server";
import { withBrowser } from "./audit-browser.ts";
import { applyPreSaveAuditValidation } from "./audit-presave-validation.server.ts";
import { tryIncrementalReaudit } from "./audit-incremental.server.ts";
import { getEnv } from "./env.server.ts";

import { clearLogContext, logger, setLogContext } from "./logger.ts";
import { decryptStorefrontPassword } from "./storefront-password.server.ts";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

const QUEUE_HEARTBEAT_MS = 60_000;

async function resolvePreviewThemeId(
  admin: AdminClient,
  selectedThemeId: string | null | undefined,
): Promise<string | undefined> {
  if (!selectedThemeId) return undefined;
  try {
    const themes = await listThemes(admin);
    const theme = themes.find((t: { id: string }) => t.id === selectedThemeId);
    if (!theme) return undefined;
    return theme.role === "MAIN" ? undefined : numericThemeId(theme.id);
  } catch {
    return undefined;
  }
}

async function storeStillWantsAudit(storeId: string): Promise<boolean> {
  const row = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: { auditRunning: true },
  });
  return row?.auditRunning === true;
}

async function jobStopRequested(jobId: string): Promise<boolean> {
  const job = await prisma.auditJob.findUnique({
    where: { id: jobId },
    select: { stopRequested: true, status: true },
  });
  if (!job) return true;
  if (job.stopRequested) return true;
  return job.status !== "running";
}

export type ExecuteAuditOptions = {
  storeId: string;
  shopDomain: string;
  /** Request-scoped admin; refreshed before save when possible. */
  admin: AdminClient;
  jobId?: string;
  /** In-memory path only: wait for process-wide slot before starting. */
  acquireSlot?: () => Promise<void>;
  releaseSlot?: () => void;
};

export async function executeAuditRun(
  options: ExecuteAuditOptions,
): Promise<{ ok: true } | { ok: false; code: string; detail: string }> {
  const { storeId, shopDomain, jobId } = options;
  setLogContext({ shopDomain, jobId: jobId ?? null });
  const { generation, signal } = beginAuditRun(shopDomain);

  const shouldStop = async (): Promise<boolean> => {
    if (!isAuditRunCurrent(shopDomain, generation) || signal.aborted) return true;
    if (!(await storeStillWantsAudit(storeId))) return true;
    if (jobId && (await jobStopRequested(jobId))) return true;
    return false;
  };

  const heartbeatStore = setInterval(() => {
    if (isAuditRunCurrent(shopDomain, generation)) {
      void prisma.storeConfig
        .update({ where: { storeId }, data: { updatedAt: new Date() } })
        .catch(() => {});
    }
  }, QUEUE_HEARTBEAT_MS);
  heartbeatStore.unref();

  const jobHeartbeat =
    jobId &&
    setInterval(() => {
      void touchAuditJobHeartbeat(jobId).catch(() => {});
    }, AUDIT_HEARTBEAT_INTERVAL_MS);
  if (jobHeartbeat) jobHeartbeat.unref();

  try {
    if (options.acquireSlot) await options.acquireSlot();
    if (await shouldStop()) return { ok: false, code: "CANCELLED", detail: "cancelled" };

    await prisma.storeConfig.update({
      where: { storeId },
      data: { auditPhase: "discovering" },
    });

    let admin = options.admin;
    const config = await prisma.storeConfig.findUnique({ where: { storeId } });
    const password = decryptStorefrontPassword(config?.storefrontPassword) || "";
    const themeId = await resolvePreviewThemeId(admin, config?.selectedThemeId);
    const customUrls = {
      plp: config?.customPlpUrl || undefined,
      pdp: config?.customPdpUrl || undefined,
      extras: Array.isArray(config?.customPageUrls)
        ? (config.customPageUrls as unknown[]).filter(
            (u): u is string => typeof u === "string" && u.trim() !== "",
          )
        : [],
    };

    const pages = await discoverPages(
      admin,
      shopDomain,
      password || undefined,
      themeId,
      customUrls,
    );
    if (await shouldStop()) return { ok: false, code: "CANCELLED", detail: "cancelled" };

    const described = describePages(pages);
    logger.info(`[Audit] Pages discovered for ${shopDomain}: ${described.length}`);

    await prisma.storeConfig.update({
      where: { storeId },
      data: {
        auditPages: described,
        auditTotalPages: described.length,
        auditPageIndex: 0,
        auditPhase: "auditing",
        auditPageStartedAt: new Date(),
      },
    });

    const pagesState = described.map((p) => ({ ...p }));
    const runDeadlineAt = Date.now() + auditRunDeadlineMs();

    const pushProgress = async (done: number, total: number, path?: string) => {
      if (await shouldStop()) throw new AuditRunCancelledError();
      if (path) {
        const page = pagesState.find((p) => p.path === path && !p.done);
        if (page) page.done = true;
      }
      await prisma.storeConfig
        .update({
          where: { storeId },
          data: {
            auditPageIndex: done,
            auditTotalPages: total,
            auditPages: pagesState,
            updatedAt: new Date(),
          },
        })
        .catch(() => {});
    };

    // Sprint 6 — opt-in fingerprint cache before a full Chromium audit.
    let report =
      (getEnv().AUDIT_INCREMENTAL_REAUDIT
        ? await tryIncrementalReaudit({
            shopDomain,
            pages,
            password: password || undefined,
            isStopped: shouldStop,
          })
        : null) ?? null;

    if (report?.auditRunMeta?.incrementalCacheHit) {
      for (const page of pagesState) page.done = true;
      await pushProgress(described.length, described.length);
    } else {
      report = await runHiddenAudit({
        pages,
        password: password || undefined,
        shopDomain,
        signal,
        runDeadlineAt,
        shouldStop,
        onProgress: async ({ done, total, path }) => {
          await pushProgress(done, total, path);
        },
      });
    }

    if (await shouldStop()) return { ok: false, code: "CANCELLED", detail: "cancelled" };

    await prisma.storeConfig.update({
      where: { storeId },
      data: { auditPhase: "building" },
    });

    // Always run fold/LCP smoke-test — including incremental hits — so a reused
    // report cannot skip storefront safety gates that previously always ran.
    {
      const measuredReport = report;
      report = await withBrowser((browser) =>
        applyPreSaveAuditValidation(browser, pages.home, password || undefined, measuredReport),
      );
    }

    const refreshed = await resolveShopAdmin(shopDomain);
    if (refreshed.ok) admin = refreshed.admin;

    await saveAuditReport(shopDomain, report);
    // saveAuditReport clears auditRunning, so shouldStop() would now report
    // "cancelled" even for a successful run. Only a real stop request counts.
    if (jobId && (await jobStopRequested(jobId))) {
      return { ok: false, code: "CANCELLED", detail: "cancelled" };
    }

    await prisma.storeConfig.update({
      where: { storeId },
      data: {
        auditRunning: false,
        auditComplete: true,
        auditFailed: false,
        auditError: null,
        auditPageIndex: described.length,
        auditTotalPages: described.length,
        auditPhase: null,
        auditPageStartedAt: null,
      },
    });

    if (jobId) {
      await prisma.auditJob.update({
        where: { id: jobId },
        data: {
          status: "succeeded",
          finishedAt: new Date(),
          lockedAt: new Date(),
          errorCode: null,
          lastError: null,
        },
      });
      await reconcileStoreAfterJobEnd(storeId, jobId, "succeeded");
    }

    const finishedAt = Date.now();
    const startedRow = jobId
      ? await prisma.auditJob.findUnique({
          where: { id: jobId },
          select: { startedAt: true, createdAt: true },
        })
      : null;
    const runMs =
      startedRow?.startedAt != null ? finishedAt - startedRow.startedAt.getTime() : null;
    const waitMs =
      startedRow?.createdAt != null && startedRow?.startedAt != null
        ? startedRow.startedAt.getTime() - startedRow.createdAt.getTime()
        : null;
    logAuditEvent("audit_complete", {
      shop: shopDomain,
      jobId: jobId ?? null,
      runMs,
      waitMs,
    });
    logger.info(`[Audit] COMPLETED for ${shopDomain}`);
    return { ok: true };
  } catch (err) {
    if (
      err instanceof AuditRunCancelledError ||
      (err instanceof Error && err.name === "AbortError")
    ) {
      return { ok: false, code: "CANCELLED", detail: "cancelled" };
    }

    if (await shouldStop()) {
      return { ok: false, code: "CANCELLED", detail: "cancelled" };
    }

    const { code, detail } = classifyAuditFailure(
      err instanceof Error ? Object.assign(err, { name: err.constructor?.name || err.name }) : err,
    );
    logAuditEvent("audit_fail", {
      shop: shopDomain,
      jobId: jobId ?? null,
      errorCode: code,
      detail,
    });
    logger.error(`[Audit] FAILED for ${shopDomain}:`, detail);

    await prisma.storeConfig
      .update({
        where: { storeId },
        data: {
          auditRunning: false,
          auditFailed: true,
          auditError: code,
          auditComplete: false,
          auditPhase: null,
          auditPageStartedAt: null,
        },
      })
      .catch(() => {});

    await prisma.auditLog
      .create({
        data: {
          domain: shopDomain,
          audit_type: "auto-audit",
          status: "failed",
          details: detail,
        },
      })
      .catch(() => {});

    if (jobId) {
      await prisma.auditJob.update({
        where: { id: jobId },
        data: {
          status: "failed",
          finishedAt: new Date(),
          errorCode: code,
          lastError: detail,
          lockedAt: null,
        },
      });
      await reconcileStoreAfterJobEnd(storeId, jobId, "failed", detail);
    }

    return { ok: false, code, detail };
  } finally {
    clearInterval(heartbeatStore);
    if (jobHeartbeat) clearInterval(jobHeartbeat);
    endAuditRun(shopDomain, generation);
    options.releaseSlot?.();
    clearLogContext();
  }
}

export { AuditBlockedError, AuditRunTimeoutError };
