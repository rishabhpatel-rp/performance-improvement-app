import prisma from "../db.server";
import { withBrowser } from "./audit-browser.ts";
import { AuditBlockedError, runHiddenAudit } from "./audit.server.ts";
import { applyPreSaveAuditValidation } from "./audit-presave-validation.server.ts";
import { discoverCustomAuditPages } from "./custom-audit-discovery.server.ts";
import { auditDataToSummaryPayload } from "./custom-audit-summary.ts";
import { buildReadableScriptForCustomAudit } from "./custom-audit-script-input.ts";
import { logger } from "./logger.ts";
import { assertPublicHost } from "../../shared/custom-audit-url.ts";

const USER_MESSAGES: Record<string, string> = {
  PASSWORD_REQUIRED: "This site is password protected — re-run with its storefront password.",
  PASSWORD_INCORRECT: "The password didn't unlock this site — check it and retry.",
  INVALID_URL: "That host cannot be scanned.",
  TIMEOUT: "The scan took too long. Try again with a smaller site.",
  INTERNAL: "The scan failed unexpectedly. Please try again.",
};

async function fail(runId: string, code: string, message?: string) {
  await prisma.customAuditRun.update({
    where: { id: runId },
    data: {
      status: "failed",
      phase: null,
      errorCode: code,
      error: message ?? USER_MESSAGES[code] ?? USER_MESSAGES.INTERNAL,
      finishedAt: new Date(),
    },
  });
}

export async function runCustomAudit(runId: string, url: string, password?: string): Promise<void> {
  try {
    const hostProblem = await assertPublicHost(url);
    if (hostProblem) {
      await fail(runId, "INVALID_URL", hostProblem);
      return;
    }

    await prisma.customAuditRun.update({
      where: { id: runId },
      data: { status: "running", phase: "validating", startedAt: new Date() },
    });

    const pages = await discoverCustomAuditPages(url, password);
    await prisma.customAuditRun.update({
      where: { id: runId },
      data: {
        phase: "discovering",
        totalPages: 1 + (pages.plp ? 1 : 0) + (pages.pdp ? 1 : 0) + (pages.extras?.length ?? 0),
      },
    });

    const report = await runHiddenAudit({
      pages,
      password,
      onProgress: async ({ done, total }) => {
        await prisma.customAuditRun.update({
          where: { id: runId },
          data: {
            phase: "scanning",
            pageIndex: done,
            totalPages: total,
            progress: total > 0 ? Math.min(95, 15 + Math.round((done / total) * 75)) : 15,
          },
        });
      },
      runDeadlineAt: Date.now() + 10 * 60_000,
    });

    await prisma.customAuditRun.update({
      where: { id: runId },
      data: { phase: "finalizing", progress: 96 },
    });

    const validated = await withBrowser((browser) =>
      applyPreSaveAuditValidation(browser, pages.home, password, report, false),
    );
    const summary = auditDataToSummaryPayload(validated);
    const readableScript = buildReadableScriptForCustomAudit(validated, pages);

    await prisma.customAuditRun.update({
      where: { id: runId },
      data: {
        status: "complete",
        phase: null,
        progress: 100,
        pageIndex: validated.pagesAudited?.length ?? 0,
        totalPages: validated.pagesAudited?.length ?? 0,
        errorCode: null,
        error: null,
        summary: summary as object,
        readableScript,
        report: validated as object,
        finishedAt: new Date(),
      },
    });
  } catch (err) {
    if (err instanceof AuditBlockedError) {
      await fail(runId, err.code);
      return;
    }
    logger.error("[custom-audit] Scan failed:", err instanceof Error ? err.message : String(err));
    await fail(runId, "INTERNAL");
  }
}
