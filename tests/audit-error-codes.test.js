import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyAuditFailure, retryBackoffMs } from "../app/lib/audit-error-codes.server.ts";

test("classifyAuditFailure maps browser crash", () => {
  const r = classifyAuditFailure(new Error("Target closed"));
  assert.equal(r.code, "BROWSER_CRASH");
  assert.equal(r.transient, true);
});

test("retryBackoffMs grows with attempt", () => {
  assert.ok(retryBackoffMs(1) < retryBackoffMs(2));
});

test("classifyAuditFailure maps blocked password errors", () => {
  const err = new Error("Storefront password required");
  err.name = "AuditBlockedError";
  const r = classifyAuditFailure(err);
  assert.equal(r.code, "PASSWORD_REQUIRED");
  assert.equal(r.transient, false);
});
