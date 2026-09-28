// Fixed-window login throttle (REMEDIATION_PROMPT.md Task 9).
//
// DECISION NEEDED: limits below (5 failures / 15 min per email+IP key) are a
// conservative default, not a product decision — tune MAX_ATTEMPTS/WINDOW_MS.
// State is in-process memory, so it resets on restart and is NOT shared
// across multiple instances. If the admin panel runs on >1 instance, back
// this with Redis/Postgres instead; the function signatures can stay the same.

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

type Entry = { count: number; resetAt: number };
const attempts = new Map<string, Entry>();

export function checkRateLimit(
  key: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number } {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= MAX_ATTEMPTS) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailure(key: string, now: number = Date.now()): void {
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    entry.count += 1;
  }
  // Opportunistic cleanup so the map can't grow without bound.
  if (attempts.size > 10_000) {
    for (const [k, v] of attempts) if (v.resetAt <= now) attempts.delete(k);
  }
}

export function resetAttempts(key: string): void {
  attempts.delete(key);
}

export function loginKey(email: string, ip: string): string {
  return `${String(email).trim().toLowerCase()}|${ip}`;
}
