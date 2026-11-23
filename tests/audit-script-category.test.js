import test from "node:test";
import assert from "node:assert/strict";
import { classifyScriptCategory } from "../app/lib/audit-script-category.ts";

test("classifyScriptCategory detects payments and analytics", () => {
  assert.equal(classifyScriptCategory("checkout/paypal.js"), "payments");
  assert.equal(classifyScriptCategory("gtag/js"), "analytics");
  assert.equal(classifyScriptCategory("assets/theme.js"), "theme");
});
