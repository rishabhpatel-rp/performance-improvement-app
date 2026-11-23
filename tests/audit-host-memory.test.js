import { test } from "node:test";
import assert from "node:assert/strict";
import { hostMemoryUseRatio, memoryAboveWatermark } from "../app/lib/audit-host-memory.server.ts";

test("hostMemoryUseRatio is between 0 and 1", () => {
  const r = hostMemoryUseRatio();
  assert.ok(r >= 0 && r <= 1);
});

test("memoryAboveWatermark respects null watermark", () => {
  assert.equal(memoryAboveWatermark(null), false);
});
