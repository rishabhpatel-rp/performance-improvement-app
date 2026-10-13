-- Per-template script lists (Global / Home / Collection / Product)

ALTER TABLE "StoreConfig" ADD COLUMN "auditDeferGlobal" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "auditDeferHome" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "auditDeferCollection" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "auditDeferProduct" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "StoreConfig" ADD COLUMN "auditHideGlobal" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "auditHideHome" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "auditHideCollection" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "auditHideProduct" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "StoreConfig" ADD COLUMN "staticDeferDefaultsGlobal" JSONB NOT NULL DEFAULT '["wpm","gtm"]';
ALTER TABLE "StoreConfig" ADD COLUMN "staticDeferDefaultsHome" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "staticDeferDefaultsCollection" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "staticDeferDefaultsProduct" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayScriptsGlobal" JSONB NOT NULL DEFAULT '["wpm","gtm"]';
ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayScriptsHome" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayScriptsCollection" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayScriptsProduct" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayMsGlobal" INTEGER NOT NULL DEFAULT 12000;
ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayMsHome" INTEGER NOT NULL DEFAULT 12000;
ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayMsCollection" INTEGER NOT NULL DEFAULT 12000;
ALTER TABLE "StoreConfig" ADD COLUMN "firstUserDelayMsProduct" INTEGER NOT NULL DEFAULT 12000;

ALTER TABLE "StoreConfig" ADD COLUMN "everyTimeDelayMsGlobal" INTEGER NOT NULL DEFAULT 6000;
ALTER TABLE "StoreConfig" ADD COLUMN "everyTimeDelayMsHome" INTEGER NOT NULL DEFAULT 6000;
ALTER TABLE "StoreConfig" ADD COLUMN "everyTimeDelayMsCollection" INTEGER NOT NULL DEFAULT 6000;
ALTER TABLE "StoreConfig" ADD COLUMN "everyTimeDelayMsProduct" INTEGER NOT NULL DEFAULT 6000;

UPDATE "StoreConfig" SET
  "auditDeferGlobal" = "auditDeferArray",
  "auditHideGlobal" = "auditHideSelectors",
  "staticDeferDefaultsGlobal" = "staticDeferDefaults",
  "firstUserDelayScriptsGlobal" = "firstUserDelayScripts",
  "firstUserDelayMsGlobal" = "firstUserDelayMs",
  "everyTimeDelayMsGlobal" = "everyTimeDelayMs";
