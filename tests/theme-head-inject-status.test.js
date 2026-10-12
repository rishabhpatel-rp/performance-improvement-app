import { test } from "node:test";
import assert from "node:assert/strict";
import { isThemeFilesExemptDenied } from "../app/lib/theme-head-inject-utils.js";

test("isThemeFilesExemptDenied detects Shopify exemption message", () => {
  assert.equal(
    isThemeFilesExemptDenied(
      "Access denied for themeFilesUpsert field. Required access: exemption from Shopify",
    ),
    true,
  );
  assert.equal(isThemeFilesExemptDenied("no theme id"), false);
});
