import { test } from "node:test";
const RUN = Math.random().toString(36).slice(2);
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  checkRateLimit,
  loginKey,
  recordFailure,
  resetAttempts,
} from "../src/lib/rate-limit.ts";

test("allows attempts until the limit, then blocks with Retry-After", async () => {
  const key = loginKey(`${RUN}:A@x.com`, "1.1.1.1");
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal((await checkRateLimit(key, t0)).allowed, true);
    await recordFailure(key, t0);
  }
  const blocked = await checkRateLimit(key, t0 + 1000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("window expiry unblocks", async () => {
  const key = loginKey(`${RUN}:b@x.com`, "2.2.2.2");
  const t0 = 5_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(key, t0);
  assert.equal((await checkRateLimit(key, t0)).allowed, false);
  assert.equal((await checkRateLimit(key, t0 + WINDOW_MS + 1)).allowed, true);
});

test("success resets and keys are case-insensitive on email", async () => {
  assert.equal(loginKey("A@X.com", "ip"), loginKey("a@x.com", "ip"));
  const key = loginKey(`${RUN}:c@x.com`, "3.3.3.3");
  for (let i = 0; i < MAX_ATTEMPTS; i++) await recordFailure(key, 1);
  await resetAttempts(key);
  assert.equal((await checkRateLimit(key, 1)).allowed, true);
});
