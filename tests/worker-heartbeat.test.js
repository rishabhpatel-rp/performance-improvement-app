import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { heartbeatIsFresh, missingWorkerMessage } from "../app/lib/worker-heartbeat-policy.ts";

const STALE_MS = 2 * 60_000;
const NOW = 1_000_000_000_000;

test("fresh worker heartbeat is detected", () => {
  assert.equal(heartbeatIsFresh(new Date(NOW - 30_000).toISOString(), NOW, STALE_MS), true);
});

test("stale heartbeat is detected", () => {
  assert.equal(heartbeatIsFresh(new Date(NOW - STALE_MS - 1).toISOString(), NOW, STALE_MS), false);
});

test("missing heartbeat is not fresh", () => {
  assert.equal(heartbeatIsFresh(null, NOW, STALE_MS), false);
});

test("startup warning tells the operator how to start the worker", () => {
  const msg = missingWorkerMessage();
  assert.match(msg, /AUDIT_USE_DB_QUEUE/);
  assert.match(msg, /docker-start-worker/);
});

test("server boot registers the heartbeat and the startup warning", () => {
  const src = fs.readFileSync(new URL("../app/lib/boot.server.ts", import.meta.url), "utf8");
  assert.match(src, /registerWorkerHeartbeat\(\)/);
  assert.match(src, /warnIfNoWorkerOnBoot\(\)/);
});

test("worker entry starts the heartbeat", () => {
  const src = fs.readFileSync(new URL("../app/worker/audit-worker.ts", import.meta.url), "utf8");
  assert.match(src, /registerWorkerHeartbeat\(\)/);
});
