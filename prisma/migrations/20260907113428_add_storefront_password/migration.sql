-- Add storefrontPassword to StoreConfig.
-- Nullable, additive column: used to bypass the Shopify storefront password
-- page during the hidden audit for password-protected (e.g. dev) stores.

ALTER TABLE "StoreConfig" ADD COLUMN "storefrontPassword" TEXT;
