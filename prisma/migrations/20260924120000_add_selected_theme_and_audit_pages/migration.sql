-- AlterTable
ALTER TABLE "StoreConfig" ADD COLUMN     "auditPageStartedAt" TIMESTAMP(3),
ADD COLUMN     "auditPages" JSONB,
ADD COLUMN     "selectedThemeId" TEXT;
