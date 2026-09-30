-- Bump the session version on password change so existing admin-session
-- cookies stop validating (they carry the version they were issued with).
-- Safe to re-run: ADD COLUMN IF NOT EXISTS.
ALTER TABLE "AdminUser"
  ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0;
