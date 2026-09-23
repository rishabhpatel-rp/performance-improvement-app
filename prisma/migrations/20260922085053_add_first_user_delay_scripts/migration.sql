-- AlterTable
ALTER TABLE "StoreConfig" ADD COLUMN     "everyTimeDelayMs" INTEGER NOT NULL DEFAULT 6000,
ADD COLUMN     "firstUserDelayMs" INTEGER NOT NULL DEFAULT 12000,
ADD COLUMN     "firstUserDelayScripts" JSONB NOT NULL DEFAULT '["anime.js"]',
ADD COLUMN     "firstUserDelayScriptsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "firstUserDelayScriptsPreserved" JSONB NOT NULL DEFAULT '[]';
