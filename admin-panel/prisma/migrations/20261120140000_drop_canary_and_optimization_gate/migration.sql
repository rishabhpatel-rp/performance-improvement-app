ALTER TABLE "StoreConfig" DROP COLUMN IF EXISTS "canaryPercent";
ALTER TABLE "StoreConfig" DROP COLUMN IF EXISTS "canaryStartedAt";
ALTER TABLE "StoreConfig" DROP COLUMN IF EXISTS "canaryErrRate";
ALTER TABLE "StoreConfig" DROP COLUMN IF EXISTS "auditOptimizationGate";
ALTER TABLE "StoreConfig" DROP COLUMN IF EXISTS "psiBaselineLcp";
ALTER TABLE "StoreConfig" DROP COLUMN IF EXISTS "psiBaselineCls";