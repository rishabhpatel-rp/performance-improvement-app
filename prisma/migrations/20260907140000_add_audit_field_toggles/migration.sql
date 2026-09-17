-- AlterTable
ALTER TABLE "StoreConfig" ADD COLUMN     "auditDeferArrayEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StoreConfig" ADD COLUMN     "auditHideSelectorsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StoreConfig" ADD COLUMN     "staticDeferDefaultsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "StoreConfig" ADD COLUMN     "auditDeferArrayPreserved" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN     "auditHideSelectorsPreserved" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN     "staticDeferDefaultsPreserved" JSONB NOT NULL DEFAULT '[]';
