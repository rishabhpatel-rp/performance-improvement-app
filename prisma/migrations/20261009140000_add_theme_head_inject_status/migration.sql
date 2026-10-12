-- Track automated theme head injection (themeFilesUpsert path).
ALTER TABLE "StoreConfig" ADD COLUMN "themeHeadInjectStatus" TEXT;
ALTER TABLE "StoreConfig" ADD COLUMN "themeHeadInjectAttemptedAt" TIMESTAMP(3);
ALTER TABLE "StoreConfig" ADD COLUMN "themeHeadInjectError" TEXT;
