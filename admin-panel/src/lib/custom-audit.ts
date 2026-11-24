import { prisma } from "@/lib/prisma";
import type { AuditSummaryPayload } from "@/components/step2/step2-audit-table";

export type CustomAuditRunView = {
  id: string;
  url: string;
  status: string;
  phase: string | null;
  progress: number;
  pageIndex: number;
  totalPages: number;
  errorCode: string | null;
  error: string | null;
  summary: AuditSummaryPayload | null;
  readableScript: string | null;
  finishedAt: string | null;
};

export async function getCustomAuditRun(runId: string): Promise<CustomAuditRunView | null> {
  const row = await prisma.customAuditRun.findUnique({ where: { id: runId } });
  if (!row) return null;
  return {
    id: row.id,
    url: row.url,
    status: row.status,
    phase: row.phase,
    progress: row.progress,
    pageIndex: row.pageIndex,
    totalPages: row.totalPages,
    errorCode: row.errorCode,
    error: row.error,
    summary: (row.summary as unknown as AuditSummaryPayload) ?? null,
    readableScript: row.readableScript,
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
  };
}
