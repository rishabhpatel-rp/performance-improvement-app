-- Extra merchant-specified audit pages, added with the "+" button in Step 1.
-- JSONB array of paths, e.g. '["/pages/about","/blogs/news"]'.
ALTER TABLE "StoreConfig"
  ADD COLUMN IF NOT EXISTS "customPageUrls" JSONB NOT NULL DEFAULT '[]';
