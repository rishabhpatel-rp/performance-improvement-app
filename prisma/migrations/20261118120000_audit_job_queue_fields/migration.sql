-- Audit queue hardening (audit-system-health-plan §3.4)
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "priority" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "maxAttempts" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "workerId" TEXT;
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3);
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3);
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "errorCode" TEXT;
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "trigger" TEXT;

CREATE INDEX IF NOT EXISTS "AuditJob_status_priority_createdAt_idx"
  ON "AuditJob"("status", "priority", "createdAt");