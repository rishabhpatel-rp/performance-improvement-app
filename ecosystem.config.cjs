/**
 * PM2 layout for PagePulse (audit-system-health-plan Phase 4).
 * Sized for the live 2 vCPU / 4 GB host — do not raise concurrency without soak proof.
 * Web serves merchants; worker drains AuditJob queue only.
 */
module.exports = {
  apps: [
    {
      name: "pagepulse-web",
      cwd: __dirname,
      script: "npm",
      args: "run start",
      env: {
        AUDIT_USE_DB_QUEUE: "true",
        AUDIT_WORKER_ENABLED: "false",
        // Keep web from competing with Chromium on a 4 GB box.
        AUDIT_MAX_CONCURRENT_SHOPS: "1",
        AUDIT_MAX_PARALLEL_PAGES: "2",
      },
      max_memory_restart: "512M",
    },
    {
      name: "pagepulse-audit-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker", // tsx is a root dependency; no runtime download
      env: {
        AUDIT_USE_DB_QUEUE: "true",
        AUDIT_WORKER_ENABLED: "true",
        AUDIT_MAX_CONCURRENT_SHOPS: "1",
        AUDIT_MAX_PARALLEL_PAGES: "2",
        AUDIT_MEMORY_HIGH_WATERMARK: "0.70",
      },
      // Leave ~1.5–2 GB for OS + Postgres + nginx + Chromium peak.
      max_memory_restart: "1200M",
      kill_timeout: 120000,
    },
  ],
};
