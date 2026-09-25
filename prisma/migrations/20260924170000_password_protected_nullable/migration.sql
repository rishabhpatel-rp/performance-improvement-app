-- AlterTable: "isPasswordProtected" becomes tri-state (NULL = not determined yet).
ALTER TABLE "StoreConfig" ALTER COLUMN "isPasswordProtected" DROP NOT NULL,
ALTER COLUMN "isPasswordProtected" DROP DEFAULT;

-- Existing `false` values came from a check that returned false on any timeout or
-- error, so they may be wrong. Reset them to "not determined"; the dashboard
-- re-checks them in the background. Confirmed `true` values are kept.
UPDATE "StoreConfig" SET "isPasswordProtected" = NULL WHERE "isPasswordProtected" = false;
