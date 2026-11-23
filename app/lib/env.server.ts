/** One typed view of the environment. All process.env reads live here. */

export interface AppEnv {
  NODE_ENV: string;
  SHOPIFY_API_KEY: string;
  SHOPIFY_API_SECRET: string;
  SHOPIFY_APP_URL: string;
  SCOPES: string[];
  SHOP_CUSTOM_DOMAIN: string;
  DATABASE_URL: string;
  INTERNAL_API_SECRET: string;
  STOREFRONT_PASSWORD_KEY: string;
  GOOGLE_PSI_API_KEY: string;
  CHROMIUM_PATH: string;
  HOSTNAME: string;
  PAGEPULSE_THEME_HEAD_INJECT: string;
  AUDIT_USE_DB_QUEUE: boolean;
  AUDIT_WORKER_ENABLED: string;
  AUDIT_WORKER_ID: string;
  AUDIT_MAX_QUEUE_DEPTH: number;
  AUDIT_SHOP_COOLDOWN_MINUTES: number;
  AUDIT_DRAIN_POLL_MS: number;
  AUDIT_MAX_ATTEMPTS: number;
  AUDIT_RUN_DEADLINE_MINUTES: number;
  AUDIT_MEMORY_HIGH_WATERMARK: string;
  AUDIT_MAX_CONCURRENT_SHOPS: number;
  AUDIT_STALE_MINUTES: number;
  AUDIT_MAX_PARALLEL_PAGES: number;
  AUDIT_MAX_EXTRA_PAGES: number;
  AUDIT_ETA_MINUTES_PER_SHOP: number;
  AUDIT_LAB_THROTTLE: string;
}

let cached: AppEnv | null = null;

function str(key: string, fallback = ""): string {
  return process.env[key] ?? fallback;
}

function num(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

export function getEnv(): AppEnv {
  if (cached) return cached;
  const required = ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "DATABASE_URL"];
  const missing = required.filter((key) => !process.env[key]);
  if (process.env.NODE_ENV === "production" && missing.length) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}`);
  }
  cached = {
    NODE_ENV: str("NODE_ENV", "development"),
    SHOPIFY_API_KEY: str("SHOPIFY_API_KEY"),
    SHOPIFY_API_SECRET: str("SHOPIFY_API_SECRET"),
    SHOPIFY_APP_URL: str("SHOPIFY_APP_URL"),
    SCOPES: str("SCOPES")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    SHOP_CUSTOM_DOMAIN: str("SHOP_CUSTOM_DOMAIN"),
    DATABASE_URL: str("DATABASE_URL"),
    INTERNAL_API_SECRET: str("INTERNAL_API_SECRET") || str("ADMIN_INTERNAL_SECRET"),
    STOREFRONT_PASSWORD_KEY: str("STOREFRONT_PASSWORD_KEY"),
    GOOGLE_PSI_API_KEY: str("GOOGLE_PSI_API_KEY"),
    CHROMIUM_PATH: str("CHROMIUM_PATH"),
    HOSTNAME: str("HOSTNAME", "local"),
    PAGEPULSE_THEME_HEAD_INJECT: str("PAGEPULSE_THEME_HEAD_INJECT"),
    AUDIT_USE_DB_QUEUE: str("AUDIT_USE_DB_QUEUE") === "true",
    AUDIT_WORKER_ENABLED: str("AUDIT_WORKER_ENABLED"),
    AUDIT_WORKER_ID: str("AUDIT_WORKER_ID"),
    AUDIT_MAX_QUEUE_DEPTH: num("AUDIT_MAX_QUEUE_DEPTH", 200),
    AUDIT_SHOP_COOLDOWN_MINUTES: num("AUDIT_SHOP_COOLDOWN_MINUTES", 10),
    AUDIT_DRAIN_POLL_MS: num("AUDIT_DRAIN_POLL_MS", 5000),
    AUDIT_MAX_ATTEMPTS: num("AUDIT_MAX_ATTEMPTS", 2),
    AUDIT_RUN_DEADLINE_MINUTES: num("AUDIT_RUN_DEADLINE_MINUTES", 10),
    AUDIT_MEMORY_HIGH_WATERMARK: str("AUDIT_MEMORY_HIGH_WATERMARK"),
    // Defaults sized for a 2 vCPU / 4 GB host; raise only after soak on larger boxes.
    AUDIT_MAX_CONCURRENT_SHOPS: num("AUDIT_MAX_CONCURRENT_SHOPS", 1),
    AUDIT_STALE_MINUTES: num("AUDIT_STALE_MINUTES", 12),
    AUDIT_MAX_PARALLEL_PAGES: num("AUDIT_MAX_PARALLEL_PAGES", 2),
    AUDIT_MAX_EXTRA_PAGES: num("AUDIT_MAX_EXTRA_PAGES", 5),
    AUDIT_ETA_MINUTES_PER_SHOP: num("AUDIT_ETA_MINUTES_PER_SHOP", 12),
    AUDIT_LAB_THROTTLE: str("AUDIT_LAB_THROTTLE"),
  };
  return cached;
}

export function resetEnvCacheForTests(): void {
  cached = null;
}
