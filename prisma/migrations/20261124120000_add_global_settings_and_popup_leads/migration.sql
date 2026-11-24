CREATE TABLE IF NOT EXISTS "GlobalSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "GlobalSetting_pkey" PRIMARY KEY ("key")
);

INSERT INTO "GlobalSetting" ("key", "value", "updatedAt")
VALUES ('step2OfferPopupEnabled', 'false'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

CREATE TABLE IF NOT EXISTS "PopupLead" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PopupLead_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "PopupLead_shopDomain_idx" ON "PopupLead"("shopDomain");
CREATE INDEX IF NOT EXISTS "PopupLead_createdAt_idx" ON "PopupLead"("createdAt");
