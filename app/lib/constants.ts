export const DASHBOARD_STALE_MS = 10 * 60_000;
export const DASHBOARD_ACTIVE_POLL_MS = 1_000;
export const DASHBOARD_QUEUED_POLL_MS = 5_000;
export const FOCUS_REVALIDATE_MIN_MS = 20_000;

export const DEFAULT_DELAY_SCRIPTS: readonly string[] = ["wpm", "gtm"];
export const FIRST_USER_DELAY_MS = 12_000;
export const EVERY_TIME_DELAY_MS = 6_000;

export const SETTLE_SAFETY_NET_MS = 40_000;

export const QUEUE_ETA_MINUTES_PER_SHOP = 12;

export const WORKER_HEARTBEAT_STALE_MS = 2 * 60_000;
export const WORKER_HEARTBEAT_WRITE_MS = 60_000;

export const MAX_EXTRA_PAGES = 5;

/** Fallback constant; live cap is `AUDIT_MAX_CONCURRENT_SHOPS` (default 1 on 4 GB hosts). */
export const MAX_CONCURRENT_AUDITS = 1;
export const AUDIT_RUN_DEADLINE_MS = 10 * 60_000;
