import { test } from "node:test";
import assert from "node:assert/strict";
import { isJobAheadInQueue } from "../app/lib/audit-queue-position.ts";

test("higher priority is ahead", () => {
  assert.equal(
    isJobAheadInQueue({ priority: 2, createdAtMs: 100 }, { priority: 1, createdAtMs: 50 }),
    true,
  );
});

test("same priority uses earlier createdAt", () => {
  assert.equal(
    isJobAheadInQueue({ priority: 0, createdAtMs: 10 }, { priority: 0, createdAtMs: 99 }),
    true,
  );
  assert.equal(
    isJobAheadInQueue({ priority: 0, createdAtMs: 100 }, { priority: 0, createdAtMs: 99 }),
    false,
  );
});
