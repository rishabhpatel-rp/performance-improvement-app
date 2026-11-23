# Audit system — ops sizing defaults (plan §9)

Use this when you do not yet have production crash logs. Replace numbers after the first soak on your host.

## Assumed baseline host

| Resource         | Starting assumption                                       |
| ---------------- | --------------------------------------------------------- |
| RAM              | 4 GB VPS, Postgres on same box                            |
| CPU              | 2 vCPU                                                    |
| Deploy           | PM2: `web` + `audit-worker` (`ecosystem.config.cjs`)      |
| Concurrent shops | `AUDIT_MAX_CONCURRENT_SHOPS=1` until soak proves headroom |

## Recommended PM2 memory limits (first pass)

| Process        | `max_memory_restart` | Notes                                                      |
| -------------- | -------------------- | ---------------------------------------------------------- |
| `web`          | `512M`               | No Chromium when `AUDIT_WORKER_ENABLED=false` on web       |
| `audit-worker` | `1200M`              | One shop at a time; leave RAM for OS + Postgres + Chromium |

## Env defaults (already in code)

See [audit-implementation-status.md](./audit-implementation-status.md). Flip `AUDIT_USE_DB_QUEUE=true` on **worker first**, then web (enqueue only).

## Dev laptops

If soak logs `audit_claim_skipped` with `reason: memory_high` while the queue never drains, baseline host RAM is already above the default watermark. For local soak set `AUDIT_MEMORY_HIGH_WATERMARK=off` or `0.85` in root `.env`. Production should use measured cgroup/host headroom, not `off`.

## When to raise concurrency

Only after:

1. `scripts/audit-soak.ts` with 10+ enqueues — no OOM, queue drains serially.
2. Peak worker RSS recorded (`logAuditEvent` includes `rssMb`).
3. Web p95 loader stays within +20% during an audit (manual or `autocannon`).

## What to paste from production when available

- `dmesg | grep -i oom` around incident
- `pm2 logs` + Chromium `Target closed` lines
- `POST /api/internal/audit-metrics` snapshot during backlog
- Shop count + audits/day
