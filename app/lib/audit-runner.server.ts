import prisma from "../db.server";
import {
  discoverPages,
  runHiddenAudit,
  describePages,
  AuditBlockedError,
} from "./audit.server";
import { saveAuditReport } from "./store-sync.server";
import { listThemes, numericThemeId } from "./theme-embed.server";
import { logAuditPageDone } from "./audit-logging.server";
import { touchAuditJobHeartbeat, prepareStoreForNewAudit } from "./audit-queue-reconcile.server";
import { AUDIT_HEARTBEAT_INTERVAL_MS } from "./audit-lifecycle";
import { maybeSweepStaleAuditStateForShop } from "./audit-watchdog.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

async function resolvePreviewThemeId(
  admin: AdminClient,
  selectedThemeId: string | null | undefined,
): Promise<string | undefined> {
  if (!selectedThemeId) return undefined;
  try {
    const themes = await listThemes(admin);
    const theme = themes.find((t: { id: string }) => t.id === selectedThemeId);
    if (!theme) {
      console.warn(
        `[audit] Selected theme ${selectedThemeId} not found; auditing the live theme.`,
      );
      return undefined;
    }
    return theme.role === "MAIN" ? undefined : numericThemeId(theme.id);
  } catch (err) {
    console.warn(
      "[audit] Could not resolve selected theme:",
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

export async function startAuditForStore(
  admin: AdminClient,
  shopDomain: string,
  { enableOnCreate = false }: { enableOnCreate?: boolean } = {},
): Promise<{ started: boolean; reason?: string }> {
  await maybeSweepStaleAuditStateForShop(shopDomain, { force: true }).catch(
    () => undefined,
  );

  const prepared = await prepareStoreForNewAudit(shopDomain);
  if (!prepared) {
    console.warn(`[Audit] SKIPPED — no Store row for ${shopDomain}.`);
    return { started: false, reason: "store_not_found" };
  }
  const storeId = prepared.storeId;

  await prisma.storeConfig.upsert({
    where: { storeId },
    create: {
      storeId,
      auditPhase: "discovering",
      appEnabled: enableOnCreate,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      auditRunning: true,
      auditFailed: false,
      auditError: null,
      auditPageStartedAt: new Date(),
    },
    update: {
      auditRunning: true,
      auditFailed: false,
      auditError: null,
      auditComplete: false,
      auditPageIndex: 0,
      auditTotalPages: 0,
      auditPages: [],
      auditPageStartedAt: new Date(),
      auditPhase: "discovering",
    },
  });

  const { enqueueAuditJob } = await import("./audit-queue.server");
  const result = await enqueueAuditJob(shopDomain, storeId, { enableOnCreate });
  if (!result.enqueued) {
    await prisma.storeConfig.update({
      where: { storeId },
      data: {
        auditRunning: false,
        auditPhase: null,
        activeAuditJobId: null,
      },
    });
    return { started: false, reason: result.reason };
  }

  console.log(`[Audit] QUEUED for ${shopDomain}`);
  return { started: true };
}

/** Runs one full audit (discover → measure → save). Invoked by the job queue. */
export async function executeAuditJob(
  admin: AdminClient,
  shopDomain: string,
  { jobId }: { jobId: string },
): Promise<void> {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) throw new Error(`No store for ${shopDomain}`);
  const storeId = store.id;

  const isCurrentRun = async () => {
    const job = await prisma.auditJob.findUnique({
      where: { id: jobId },
      select: { status: true, stopRequested: true },
    });
    if (!job || job.stopRequested) return false;
    return job.status === "running";
  };

  const bumpStoreLife = () =>
    prisma.storeConfig
      .updateMany({
        where: { storeId, activeAuditJobId: jobId },
        data: { auditPageStartedAt: new Date() },
      })
      .catch(() => {});

  const heartbeatTimer = setInterval(() => {
    void (async () => {
      if (!(await isCurrentRun())) {
        clearInterval(heartbeatTimer);
        return;
      }
      await touchAuditJobHeartbeat(jobId);
      await bumpStoreLife();
    })();
  }, AUDIT_HEARTBEAT_INTERVAL_MS);

  try {
    await touchAuditJobHeartbeat(jobId);
    if (!(await isCurrentRun())) return;

    await prisma.storeConfig.updateMany({
      where: { storeId, activeAuditJobId: jobId },
      data: {
        auditPhase: "discovering",
        auditPageStartedAt: new Date(),
      },
    });

    const config = await prisma.storeConfig.findUnique({ where: { storeId } });
    const password = config?.storefrontPassword || "";
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
    const described = describePages(pages);
    console.log(
      `[Audit] Pages discovered for ${shopDomain}: ${described
        .map((p) => `${p.label} ${p.path}`)
        .join(", ")}`,
    );

    if (!(await isCurrentRun())) return;
    await prisma.storeConfig.updateMany({
      where: { storeId, activeAuditJobId: jobId },
      data: {
        auditPages: described,
        auditTotalPages: described.length,
        auditPageIndex: 0,
        auditPhase: "auditing",
        auditPageStartedAt: new Date(),
      },
    });

    const pagesState = described.map((p) => ({ ...p }));

    const report = await runHiddenAudit({
      pages,
      password: password || undefined,
      shopDomain,
      onProgress: async ({ done, total, path, pass, waitMs, scripts, emitted, foldOk }) => {
        if (!(await isCurrentRun())) return;
        await touchAuditJobHeartbeat(jobId);
        if (path) {
          logAuditPageDone({
            shop: shopDomain,
            path,
            pass: pass ?? 0,
            waitMs: waitMs ?? 0,
            scripts: scripts ?? 0,
            emitted: emitted ?? 0,
            foldOk: foldOk ?? true,
          });
        }
        try {
          if (path) {
            const page = pagesState.find((p) => p.path === path && !p.done);
            if (page) page.done = true;
          }
          await prisma.storeConfig.updateMany({
            where: { storeId, activeAuditJobId: jobId },
            data: {
              auditPageIndex: done,
              auditTotalPages: total,
              auditPages: pagesState,
            },
          });
        } catch (err) {
          console.warn(
            "[Audit] Failed to record progress:",
            err instanceof Error ? err.message : err,
          );
        }
      },
    });

    if (!(await isCurrentRun())) return;
    await prisma.storeConfig.updateMany({
      where: { storeId, activeAuditJobId: jobId },
      data: { auditPhase: "building" },
    });
    await saveAuditReport(shopDomain, report, "completed", undefined, jobId);
    if (!(await isCurrentRun())) return;
    await prisma.storeConfig.updateMany({
      where: { storeId, activeAuditJobId: jobId },
      data: {
        auditRunning: false,
        auditComplete: true,
        auditFailed: false,
        auditError: null,
        auditPageIndex: described.length,
        auditTotalPages: described.length,
        auditPhase: null,
      },
    });
    console.log(`[Audit] COMPLETED for ${shopDomain}`);
  } catch (err) {
    if (!(await isCurrentRun())) return;
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[Audit] FAILED for ${shopDomain}:`, msg);
    const auditError = err instanceof AuditBlockedError ? err.code : msg;
    await prisma.storeConfig
      .updateMany({
        where: { storeId, activeAuditJobId: jobId },
        data: {
          auditRunning: false,
          auditFailed: true,
          auditError,
          auditComplete: false,
          auditPhase: null,
        },
      })
      .catch(() => {});
    await prisma.auditLog
      .create({
        data: {
          domain: shopDomain,
          audit_type: "auto-audit",
          status: "failed",
          details: msg,
        },
      })
      .catch(() => {});
    throw err;
  } finally {
    clearInterval(heartbeatTimer);
  }
}
