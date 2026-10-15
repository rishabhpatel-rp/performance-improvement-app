import { test } from "node:test";
import assert from "node:assert/strict";
import {
  staleReason,
  lastSignOfLife,
  queuedJobStale,
  planStaleSweep,
  needsOrphanStaleClear,
  auditProgressFlags,
  AUDIT_STALE_MS,
  QUEUED_JOB_STALE_MS,
} from "../app/lib/audit-lifecycle.ts";

test("auditProgressFlags ignores running when complete or failed", () => {
  assert.deepEqual(
    auditProgressFlags({
      auditRunning: true,
      auditComplete: true,
      auditFailed: false,
    }),
    { running: false, complete: true, failed: false },
  );
  assert.deepEqual(
    auditProgressFlags({
      auditRunning: true,
      auditComplete: false,
      auditFailed: false,
    }),
    { running: true, complete: false, failed: false },
  );
});

test("lastSignOfLife uses auditPageStartedAt when set", () => {
  const started = new Date("2026-01-01T12:00:00Z");
  const updated = new Date("2026-01-01T11:00:00Z");
  assert.equal(
    lastSignOfLife({
      auditRunning: true,
      auditPageStartedAt: started,
      updatedAt: updated,
    }),
    started.getTime(),
  );
});

test("lastSignOfLife falls back to updatedAt when auditPageStartedAt is null", () => {
  const updated = new Date("2026-01-01T11:00:00Z");
  assert.equal(
    lastSignOfLife({
      auditRunning: true,
      auditPageStartedAt: null,
      updatedAt: updated,
    }),
    updated.getTime(),
  );
});

test("staleReason is null when not running", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(
    staleReason(
      {
        auditRunning: false,
        auditPageStartedAt: null,
        updatedAt: new Date(now - AUDIT_STALE_MS - 1),
      },
      now,
    ),
    null,
  );
});

test("staleReason flags runs older than 15 minutes", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(
    staleReason(
      {
        auditRunning: true,
        auditPageStartedAt: null,
        updatedAt: new Date(now - AUDIT_STALE_MS - 1),
      },
      now,
    ),
    "stale_running",
  );
});

test("staleReason does not treat fresh runs as stale", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(
    staleReason(
      {
        auditRunning: true,
        auditPageStartedAt: null,
        updatedAt: new Date(now - 60_000),
      },
      now,
    ),
    null,
  );
});

test("queuedJobStale respects QUEUED_JOB_STALE_MS (3h cap)", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  assert.equal(
    queuedJobStale(new Date(now - QUEUED_JOB_STALE_MS - 1), now),
    true,
  );
  assert.equal(queuedJobStale(new Date(now - 60 * 60 * 1000), now), false);
});

test("planStaleSweep returns indices of stale rows only", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const rows = [
    {
      auditRunning: true,
      auditPageStartedAt: null,
      updatedAt: new Date(now - AUDIT_STALE_MS - 1),
    },
    {
      auditRunning: true,
      auditPageStartedAt: null,
      updatedAt: new Date(now - 1000),
    },
    { auditRunning: false, auditPageStartedAt: null, updatedAt: new Date(0) },
  ];
  assert.deepEqual(planStaleSweep(rows, now), [0]);
});

test("needsOrphanStaleClear only when running, stale, and no active job", () => {
  const now = Date.parse("2026-01-01T12:00:00Z");
  const staleRow = {
    auditRunning: true,
    auditPageStartedAt: null,
    updatedAt: new Date(now - AUDIT_STALE_MS - 1),
    activeAuditJobId: null,
  };
  assert.equal(needsOrphanStaleClear(staleRow, now), true);
  assert.equal(
    needsOrphanStaleClear({ ...staleRow, activeAuditJobId: "job-1" }, now),
    false,
  );
  assert.equal(
    needsOrphanStaleClear(
      {
        auditRunning: true,
        auditPageStartedAt: null,
        updatedAt: new Date(now - 1000),
        activeAuditJobId: null,
      },
      now,
    ),
    false,
  );
});
