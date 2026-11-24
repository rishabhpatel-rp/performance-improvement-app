CREATE TABLE IF NOT EXISTS "CustomAuditRun" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "phase" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "pageIndex" INTEGER NOT NULL DEFAULT 0,
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "error" TEXT,
    "summary" JSONB,
    "readableScript" TEXT,
    "report" JSONB,
    "requestedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomAuditRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "CustomAuditRun_status_createdAt_idx" ON "CustomAuditRun"("status", "createdAt");
