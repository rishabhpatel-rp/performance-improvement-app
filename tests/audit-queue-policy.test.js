import test from "node:test";
import assert from "node:assert/strict";
import {
  decideAdmission,
  STALE_RUNNING_MS,
} from "../app/lib/audit-queue-policy.ts";

test("decideAdmission blocks duplicate shop job", () => {
  const d = decideAdmission(true, 0);
  assert.equal(d.allow, false);
  assert.equal(d.code, "already_running");
});

test("decideAdmission allows enqueue when other shops are at global cap (queue waits)", () => {
  const d = decideAdmission(false, 3);
  assert.equal(d.allow, true);
});

test("decideAdmission allows new shop when none active for this store", () => {
  const d = decideAdmission(false, 2);
  assert.equal(d.allow, true);
});

test("STALE_RUNNING_MS is 15 minutes", () => {
  assert.equal(STALE_RUNNING_MS, 15 * 60 * 1000);
});
