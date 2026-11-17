-- CreateTable
CREATE TABLE "StoreArchive" (
    "id" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopifyShopId" TEXT,
    "shopName" TEXT,
    "email" TEXT,
    "snapshot" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "actorEmail" TEXT,
    "sourceStoreId" TEXT,
    "installedAt" TIMESTAMP(3),
    "uninstalledAt" TIMESTAMP(3),
    "redactedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StoreArchive_shopDomain_idx" ON "StoreArchive"("shopDomain");

-- CreateIndex
CREATE INDEX "StoreArchive_redactedAt_idx" ON "StoreArchive"("redactedAt");

-- CreateIndex
CREATE INDEX "StoreArchive_reason_idx" ON "StoreArchive"("reason");
