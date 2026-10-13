-- AuditJob already exists from 20261006130000_audit_job_queue_and_needs_attention (applied earlier).
-- Extend it for AUDIT-SYSTEM-OCT-12 queue + add PsiSnapshot.

ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "shopDomain" TEXT;
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "lockedAt" TIMESTAMP(3);
ALTER TABLE "AuditJob" ADD COLUMN IF NOT EXISTS "payload" JSONB;

UPDATE "AuditJob" aj
SET "shopDomain" = s."shopDomain"
FROM "Store" s
WHERE aj."storeId" = s.id
  AND (aj."shopDomain" IS NULL OR aj."shopDomain" = '');

UPDATE "AuditJob"
SET "runAt" = COALESCE("availableAt", "createdAt")
WHERE "runAt" IS NULL;

UPDATE "AuditJob"
SET "lockedAt" = "claimedAt"
WHERE "lockedAt" IS NULL AND "claimedAt" IS NOT NULL;

ALTER TABLE "AuditJob" ALTER COLUMN "shopDomain" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "AuditJob_status_runAt_idx" ON "AuditJob"("status", "runAt");
CREATE INDEX IF NOT EXISTS "AuditJob_shopDomain_idx" ON "AuditJob"("shopDomain");

CREATE TABLE IF NOT EXISTS "PsiSnapshot" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "strategy" TEXT NOT NULL DEFAULT 'mobile',
    "fieldSource" TEXT NOT NULL,
    "lcp" INTEGER,
    "inp" INTEGER,
    "cls" INTEGER,
    "lighthouseScore" INTEGER,
    "rawJson" JSONB,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PsiSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PsiSnapshot_shopDomain_fetchedAt_idx"
  ON "PsiSnapshot"("shopDomain", "fetchedAt");
