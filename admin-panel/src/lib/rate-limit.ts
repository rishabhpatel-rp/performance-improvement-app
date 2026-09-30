// Fixed-window login throttle (REMEDIATION_PROMPT.md Task 9).
//
// TWO BUCKETS are enforced: per-account (email|ip) AND per-IP alone. Either
// one alone is insufficient — see checkBoth()/recordFailureBoth().
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
  opts: { max?: number; windowMs?: number } = {},
): { allowed: boolean; retryAfterSeconds: number } {
  const max = opts.max ?? MAX_ATTEMPTS;
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  if (entry.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function recordFailure(
  key: string,
  now: number = Date.now(),
  opts: { max?: number; windowMs?: number } = {},
): void {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const entry = attempts.get(key);
  if (!entry || entry.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
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

/**
 * A second, IP-only bucket. The per-account key alone is not enough in either
 * direction: enumerating N candidate emails yields MAX_ATTEMPTS guesses on each
 * with no aggregate ceiling, and a single victim account can be attacked from N
 * different IPs at MAX_ATTEMPTS tries each. Both buckets must be satisfied.
 */
export const MAX_ATTEMPTS_PER_IP = 20;
export const WINDOW_MS_PER_IP = 15 * 60 * 1000;

export function ipKey(ip: string): string {
  return `ip|${ip}`;
}

/** True when neither the per-account nor the per-IP bucket is exhausted. */
export function checkBoth(
  accountKey: string,
  ipAddress: string,
  now: number = Date.now(),
): { allowed: boolean; retryAfterSeconds: number; scope: "account" | "ip" | null } {
  const account = checkRateLimit(accountKey, now);
  if (!account.allowed) {
    return { ...account, scope: "account" };
  }
  const perIp = checkRateLimit(ipKey(ipAddress), now, {
    max: MAX_ATTEMPTS_PER_IP,
    windowMs: WINDOW_MS_PER_IP,
  });
  if (!perIp.allowed) {
    return { ...perIp, scope: "ip" };
  }
  return { allowed: true, retryAfterSeconds: 0, scope: null };
}

/** Records a failure against BOTH buckets. */
export function recordFailureBoth(
  accountKey: string,
  ipAddress: string,
  now: number = Date.now(),
): void {
  recordFailure(accountKey, now);
  recordFailure(ipKey(ipAddress), now, {
    max: MAX_ATTEMPTS_PER_IP,
    windowMs: WINDOW_MS_PER_IP,
  });
}
