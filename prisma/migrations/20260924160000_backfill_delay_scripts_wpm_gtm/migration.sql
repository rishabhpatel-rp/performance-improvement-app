-- Data migration: existing stores that still hold the OLD default list exactly
-- (["anime.js"]) move to the new default (["wpm","gtm"]). Lists a merchant
-- edited (anything other than exactly ["anime.js"]) are left untouched.

-- 1) Invalidate the stored, pre-built storefront script for the affected stores.
--    The storefront route rebuilds a missing script on the next request, so it
--    is regenerated from the new lists (a plain UPDATE below would not trigger
--    a rebuild).
UPDATE "performance_scripts"
SET "defer_script" = NULL,
    "hidden_css" = NULL,
    "script_hash" = NULL,
    "script_built_at" = NULL
WHERE "storeId" IN (
  SELECT "storeId"
  FROM "StoreConfig"
  WHERE "staticDeferDefaults" = '["anime.js"]'::jsonb
     OR "firstUserDelayScripts" = '["anime.js"]'::jsonb
);

-- 2) Active lists.
UPDATE "StoreConfig"
SET "staticDeferDefaults" = '["wpm","gtm"]'::jsonb
WHERE "staticDeferDefaults" = '["anime.js"]'::jsonb;

UPDATE "StoreConfig"
SET "firstUserDelayScripts" = '["wpm","gtm"]'::jsonb
WHERE "firstUserDelayScripts" = '["anime.js"]'::jsonb;

-- 3) Snapshots kept while a card is toggled OFF (restored when it is turned
--    back ON), so re-enabling does not bring the old value back.
UPDATE "StoreConfig"
SET "staticDeferDefaultsPreserved" = '["wpm","gtm"]'::jsonb
WHERE "staticDeferDefaultsPreserved" = '["anime.js"]'::jsonb;

UPDATE "StoreConfig"
SET "firstUserDelayScriptsPreserved" = '["wpm","gtm"]'::jsonb
WHERE "firstUserDelayScriptsPreserved" = '["anime.js"]'::jsonb;
