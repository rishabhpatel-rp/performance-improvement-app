import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_ATTEMPTS,
  WINDOW_MS,
  checkRateLimit,
  loginKey,
  recordFailure,
  resetAttempts,
} from "../src/lib/rate-limit.ts";

test("allows attempts until the limit, then blocks with Retry-After", () => {
  const key = loginKey("A@x.com", "1.1.1.1");
  const t0 = 1_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal(checkRateLimit(key, t0).allowed, true);
    recordFailure(key, t0);
  }
  const blocked = checkRateLimit(key, t0 + 1000);
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});

test("window expiry unblocks", () => {
  const key = loginKey("b@x.com", "2.2.2.2");
  const t0 = 5_000_000;
  for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailure(key, t0);
  assert.equal(checkRateLimit(key, t0).allowed, false);
  assert.equal(checkRateLimit(key, t0 + WINDOW_MS + 1).allowed, true);
});

test("success resets and keys are case-insensitive on email", () => {
  assert.equal(loginKey("A@X.com", "ip"), loginKey("a@x.com", "ip"));
  const key = loginKey("c@x.com", "3.3.3.3");
  for (let i = 0; i < MAX_ATTEMPTS; i++) recordFailure(key, 1);
  resetAttempts(key);
  assert.equal(checkRateLimit(key, 1).allowed, true);
});
