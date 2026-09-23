-- Add isPasswordProtected to cache password protection status from Shopify
ALTER TABLE "StoreConfig" ADD COLUMN "isPasswordProtected" BOOLEAN NOT NULL DEFAULT false;

-- Add cachedAppEndpoint to enable Gate C check on fast path
ALTER TABLE "StoreConfig" ADD COLUMN "cachedAppEndpoint" TEXT;