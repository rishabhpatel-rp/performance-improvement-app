-- AlterTable
ALTER TABLE "StoreConfig" ADD COLUMN IF NOT EXISTS "onboardingActivated" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: stores that already left first-run must not auto-enable again
UPDATE "StoreConfig"
SET "onboardingActivated" = true
WHERE "appEnabled" = true
   OR "auditComplete" = true
   OR "auditFailed" = true
   OR "auditRunning" = true;
