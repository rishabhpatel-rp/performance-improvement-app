import prisma from "../db.server";
import { prepareStoreForNewAudit } from "./audit-queue-reconcile.server";
import { enqueueAuditJob } from "./audit-queue.server";
import { executeAuditRun } from "./audit-execute.server";
import { isDbAuditQueueEnabled } from "./audit-env.server";
import { MAX_CONCURRENT_AUDITS } from "./audit-queue-policy";

import { logger } from "./logger.ts";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export { auditRunDeadlineMs } from "./audit-env.server";

let runningAudits = 0;
const auditWaiters: Array<() => void> = [];

function acquireAuditSlot(): Promise<void> {
  if (runningAudits < MAX_CONCURRENT_AUDITS) {
    runningAudits += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    auditWaiters.push(() => {
      runningAudits += 1;
      resolve();
    });
  });
}

function releaseAuditSlot(): void {
  runningAudits -= 1;
  const next = auditWaiters.shift();
  if (next) next();
}

export type StartAuditOptions = {
  enableOnCreate?: boolean;
  trigger?: string;
  priority?: number;
  force?: boolean;
};

/**
 * Starts an audit: DB queue (AUDIT_USE_DB_QUEUE=true) or in-process slot + execute.
 */
export async function startAuditForStore(
  admin: AdminClient,
  shopDomain: string,
  options: StartAuditOptions = {},
): Promise<{ started: boolean; reason?: string; waiting?: boolean }> {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) {
    logger.warn(`[Audit] SKIPPED — no Store row for ${shopDomain}.`);
    return { started: false, reason: "no_store" };
  }
  const storeId = store.id;

  if (isDbAuditQueueEnabled()) {
    const prepared = await prepareStoreForNewAudit(shopDomain);
    if (!prepared) return { started: false, reason: "no_store" };

    const existing = await prisma.storeConfig.findUnique({
      where: { storeId },
      select: { auditRunning: true, auditComplete: true, auditFailed: true },
    });
    if (existing?.auditRunning && !existing.auditComplete && !existing.auditFailed) {
      return { started: false, reason: "already_running" };
    }

    await prisma.storeConfig.upsert({
      where: { storeId },
      create: {
        storeId,
        auditPhase: "queued",
        appEnabled: options.enableOnCreate === true,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: [],
        auditRunning: true,
        auditFailed: false,
        auditError: null,
      },
      update: {
        auditRunning: true,
        auditFailed: false,
        auditError: null,
        auditComplete: false,
        auditPageIndex: 0,
        auditTotalPages: 0,
        auditPages: [],
        auditPageStartedAt: null,
        auditPhase: "queued",
      },
    });

    const enq = await enqueueAuditJob(shopDomain, storeId, {
      enableOnCreate: options.enableOnCreate,
      trigger: options.trigger || "merchant",
      priority: options.priority ?? 0,
      force: options.force === true,
    });
    if (!enq.enqueued) {
      return { started: false, reason: enq.reason || "enqueue_failed" };
    }
    logger.info(`[Audit] ENQUEUED for ${shopDomain} job=${enq.jobId}`);
    return { started: true, waiting: enq.waiting };
  }

  const existing = await prisma.storeConfig.findUnique({
    where: { storeId },
    select: {
      auditRunning: true,
      auditComplete: true,
      auditFailed: true,
    },
  });
  if (existing?.auditRunning && !existing.auditComplete && !existing.auditFailed) {
    return { started: false, reason: "already_running" };
  }

  await prisma.storeConfig.upsert({
    where: { storeId },
    create: {
      storeId,
      auditPhase: "queued",
      appEnabled: options.enableOnCreate === true,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      auditRunning: true,
      auditFailed: false,
      auditError: null,
    },
    update: {
      auditRunning: true,
      auditFailed: false,
      auditError: null,
      auditComplete: false,
      auditPageIndex: 0,
      auditTotalPages: 0,
      auditPages: [],
      auditPageStartedAt: null,
      auditPhase: "queued",
    },
  });

  (async () => {
    await executeAuditRun({
      storeId,
      shopDomain,
      admin,
      acquireSlot: acquireAuditSlot,
      releaseSlot: releaseAuditSlot,
    });
  })();

  return { started: true };
}
