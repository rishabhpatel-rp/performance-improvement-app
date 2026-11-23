import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFER_BLOCK_ONLY_PATHNAMES,
  tokenEligibleForGlobalDefer,
} from "../app/lib/audit-candidates.ts";

test("cart-only scripts are not globally deferrable", () => {
  assert.ok(DEFER_BLOCK_ONLY_PATHNAMES.has("/cart"));
  assert.equal(tokenEligibleForGlobalDefer(["/cart"]), false);
  assert.equal(tokenEligibleForGlobalDefer(["/cart", "/"]), true);
  assert.equal(tokenEligibleForGlobalDefer(["/search"]), false);
  assert.equal(tokenEligibleForGlobalDefer([]), true);
});
