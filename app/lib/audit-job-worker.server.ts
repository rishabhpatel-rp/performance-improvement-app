import prisma from "../db.server";
import { executeAuditRun } from "./audit-execute.server";
import { resolveShopAdmin } from "./internal-shop-session.server.ts";
import { reconcileStoreAfterJobEnd } from "./audit-queue-reconcile.server";
import { classifyAuditFailure, retryBackoffMs } from "./audit-error-codes.server";

export async function runAuditJob(jobId: string): Promise<void> {
  const job = await prisma.auditJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "running") return;

  const session = await resolveShopAdmin(job.shopDomain);
  if (!session.ok) {
    const detail = session.error || "SHOPIFY_AUTH";
    await prisma.auditJob.update({
      where: { id: jobId },
      data: {
        status: "failed",
        errorCode: "SHOPIFY_AUTH",
        lastError: detail,
        finishedAt: new Date(),
        lockedAt: null,
      },
    });
    await reconcileStoreAfterJobEnd(job.storeId, jobId, "failed", detail);
    return;
  }

  const result = await executeAuditRun({
    storeId: job.storeId,
    shopDomain: job.shopDomain,
    admin: session.admin,
    jobId,
  });

  if (!result.ok && result.code !== "CANCELLED") {
    const row = await prisma.auditJob.findUnique({ where: { id: jobId } });
    if (!row) return;
    const transient = classifyAuditFailure(new Error(result.detail)).transient;

    if (transient && row.attempts < row.maxAttempts) {
      const runAt = new Date(Date.now() + retryBackoffMs(row.attempts));
      await prisma.auditJob.update({
        where: { id: jobId },
        data: {
          status: "queued",
          runAt,
          lockedAt: null,
          workerId: null,
          errorCode: result.code,
          lastError: result.detail,
        },
      });
      await prisma.storeConfig.update({
        where: { storeId: job.storeId },
        data: { auditPhase: "queued", auditRunning: true },
      });
    }
  }
}
