-- AuditJob: fresh DBs get CREATE; dev DBs that applied lost 20261006130000 get ALTER/backfill.
-- PsiSnapshot is always created here.

CREATE TABLE IF NOT EXISTS "AuditJob" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "stopRequested" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditJob_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'AuditJob_storeId_fkey'
  ) THEN
    ALTER TABLE "AuditJob"
      ADD CONSTRAINT "AuditJob_storeId_fkey"
      FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Legacy queue table (Oct 6 local migration): rename semantics via new columns.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AuditJob'
      AND column_name = 'availableAt'
  ) THEN
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

    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'AuditJob'
        AND column_name = 'claimedAt'
    ) THEN
      UPDATE "AuditJob"
      SET "lockedAt" = "claimedAt"
      WHERE "lockedAt" IS NULL AND "claimedAt" IS NOT NULL;
    END IF;

    ALTER TABLE "AuditJob" ALTER COLUMN "shopDomain" SET NOT NULL;
  END IF;
END $$;

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
