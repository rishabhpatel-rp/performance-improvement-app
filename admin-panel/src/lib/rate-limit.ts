// DB-backed fixed-window login/write throttle. Buckets live in Postgres so the
// limit survives restarts and is shared across instances. An in-process map is
// used only as a fallback when the database is unreachable.
import { prisma } from "@/lib/prisma";

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_ATTEMPTS_PER_IP = 20;
export const WINDOW_MS_PER_IP = 15 * 60 * 1000;

type Entry = { count: number; resetAt: number };
const memory = new Map<string, Entry>();

type Opts = { max?: number; windowMs?: number };
type Verdict = { allowed: boolean; retryAfterSeconds: number };

function evaluate(entry: Entry | null, now: number, max: number): Verdict {
  if (!entry || entry.resetAt <= now) return { allowed: true, retryAfterSeconds: 0 };
  if (entry.count >= max) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
    };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

async function read(key: string, now: number): Promise<Entry | null> {
  try {
    const row = await prisma.rateLimitBucket.findUnique({ where: { key } });
    if (!row || row.windowEnds.getTime() <= now) return null;
    return { count: row.count, resetAt: row.windowEnds.getTime() };
  } catch {
    const entry = memory.get(key);
    if (!entry || entry.resetAt <= now) return null;
    return entry;
  }
}

async function write(key: string, entry: Entry): Promise<void> {
  try {
    await prisma.rateLimitBucket.upsert({
      where: { key },
      create: { key, count: entry.count, windowEnds: new Date(entry.resetAt) },
      update: { count: entry.count, windowEnds: new Date(entry.resetAt) },
    });
  } catch {
    memory.set(key, entry);
    if (memory.size > 10_000) {
      for (const [k, v] of memory) if (v.resetAt <= Date.now()) memory.delete(k);
    }
  }
}

export async function checkRateLimit(
  key: string,
  now: number = Date.now(),
  opts: Opts = {},
): Promise<Verdict> {
  return evaluate(await read(key, now), now, opts.max ?? MAX_ATTEMPTS);
}

export async function recordFailure(
  key: string,
  now: number = Date.now(),
  opts: Opts = {},
): Promise<void> {
  const windowMs = opts.windowMs ?? WINDOW_MS;
  const current = await read(key, now);
  const entry: Entry =
    !current || current.resetAt <= now
      ? { count: 1, resetAt: now + windowMs }
      : { count: current.count + 1, resetAt: current.resetAt };
  await write(key, entry);
}

export async function consumeRateLimit(
  key: string,
  opts: { max: number; windowMs: number },
  now: number = Date.now(),
): Promise<Verdict> {
  const verdict = await checkRateLimit(key, now, opts);
  if (verdict.allowed) await recordFailure(key, now, opts);
  return verdict;
}

export async function resetAttempts(key: string): Promise<void> {
  memory.delete(key);
  try {
    await prisma.rateLimitBucket.delete({ where: { key } });
  } catch {
    // no row to delete (or DB unreachable) — nothing to do
  }
}

export function loginKey(email: string, ip: string): string {
  return `login|${String(email).trim().toLowerCase()}|${ip}`;
}

export function ipKey(ip: string): string {
  return `ip|${ip}`;
}

export async function checkBoth(
  accountKey: string,
  ipAddress: string,
  now: number = Date.now(),
): Promise<Verdict & { scope: "account" | "ip" | null }> {
  const account = await checkRateLimit(accountKey, now);
  if (!account.allowed) return { ...account, scope: "account" };
  const perIp = await checkRateLimit(ipKey(ipAddress), now, {
    max: MAX_ATTEMPTS_PER_IP,
    windowMs: WINDOW_MS_PER_IP,
  });
  if (!perIp.allowed) return { ...perIp, scope: "ip" };
  return { allowed: true, retryAfterSeconds: 0, scope: null };
}

export async function recordFailureBoth(
  accountKey: string,
  ipAddress: string,
  now: number = Date.now(),
): Promise<void> {
  await recordFailure(accountKey, now);
  await recordFailure(ipKey(ipAddress), now, {
    max: MAX_ATTEMPTS_PER_IP,
    windowMs: WINDOW_MS_PER_IP,
  });
}
