-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Store" (
    "id" TEXT NOT NULL,
    "shopifyShopId" TEXT NOT NULL,
    "shopDomain" TEXT NOT NULL,
    "shopName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "country" TEXT,
    "countryName" TEXT,
    "city" TEXT,
    "address1" TEXT,
    "address2" TEXT,
    "zip" TEXT,
    "timezone" TEXT,
    "ianaTimezone" TEXT,
    "currency" TEXT,
    "locale" TEXT,
    "shopifyPlan" TEXT,
    "totalProducts" INTEGER,
    "totalOrders" INTEGER,
    "createdAtShopify" TIMESTAMP(3),
    "installedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uninstalledAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currentScope" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Store_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreConfig" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "appEnabled" BOOLEAN NOT NULL DEFAULT false,
    "script1Enabled" BOOLEAN NOT NULL DEFAULT false,
    "script2Enabled" BOOLEAN NOT NULL DEFAULT false,
    "script3Enabled" BOOLEAN NOT NULL DEFAULT false,
    "debugMode" BOOLEAN NOT NULL DEFAULT false,
    "auditComplete" BOOLEAN NOT NULL DEFAULT false,
    "scriptTitles" JSONB NOT NULL DEFAULT '[]',
    "auditDeferArray" JSONB NOT NULL DEFAULT '[]',
    "auditHideSelectors" JSONB NOT NULL DEFAULT '[]',
    "metaobjectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreActivity" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopifyShopId_key" ON "Store"("shopifyShopId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_shopDomain_key" ON "Store"("shopDomain");

-- CreateIndex
CREATE INDEX "Store_isActive_idx" ON "Store"("isActive");

-- CreateIndex
CREATE INDEX "Store_installedAt_idx" ON "Store"("installedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoreConfig_storeId_key" ON "StoreConfig"("storeId");

-- CreateIndex
CREATE INDEX "StoreActivity_storeId_idx" ON "StoreActivity"("storeId");

-- CreateIndex
CREATE INDEX "StoreActivity_eventType_idx" ON "StoreActivity"("eventType");

-- CreateIndex
CREATE INDEX "StoreActivity_createdAt_idx" ON "StoreActivity"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_email_key" ON "AdminUser"("email");

-- AddForeignKey
ALTER TABLE "StoreConfig" ADD CONSTRAINT "StoreConfig_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoreActivity" ADD CONSTRAINT "StoreActivity_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
