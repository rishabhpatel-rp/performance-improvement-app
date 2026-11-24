/**
 * PM2 layout for PagePulse — sized for 4 vCPU / 8 GB host.
 *
 * Memory budget (8 GB):
 *   Web process (Node.js):          ~300 MB
 *   Worker process (Node.js):       ~600 MB
 *   Chromium (3 pages × ~350 MB):  ~1,050 MB  ← 3 parallel pages per pass
 *   PostgreSQL:                     ~400 MB
 *   nginx + OS:                     ~600 MB
 *   Headroom / burst:               ~5,050 MB remaining → comfortable
 *
 * CPU budget (4 cores):
 *   3 parallel Chromium pages use ~3 cores at peak load.
 *   Web + worker Node.js share the 4th core.
 *   AUDIT_MAX_CONCURRENT_SHOPS=1 until soak proves SHOPS=2 is safe on 8 GB.
 *   Sprint 2–6 flags stay false (opt-in) so prior audit accuracy is preserved.
 */
module.exports = {
  apps: [
    {
      name: "pagepulse-web",
      cwd: __dirname,
      script: "npm",
      args: "run start",
      env: {
        // Must match nginx proxy_pass (127.0.0.1:9001).
        PORT: "9001",
        AUDIT_USE_DB_QUEUE: "true",
        AUDIT_WORKER_ENABLED: "false",
        // Web process does not run audits; keep at 1 to prevent accidental
        // in-process audit if DB queue is temporarily disabled.
        AUDIT_MAX_CONCURRENT_SHOPS: "1",
        AUDIT_MAX_PARALLEL_PAGES: "3", // 4 vCPU: all 3 pages run simultaneously
      },
      // Web is stateless — restart quickly if memory spikes (usually a leak).
      max_memory_restart: "768M",
    },
    {
      name: "pagepulse-audit-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker",
      env: {
        AUDIT_USE_DB_QUEUE: "true",
        AUDIT_WORKER_ENABLED: "true",
        // Accuracy-neutral parallelism only: 1 shop × 3 pages.
        AUDIT_MAX_CONCURRENT_SHOPS: "1",
        AUDIT_MAX_PARALLEL_PAGES: "3",
        AUDIT_MEMORY_HIGH_WATERMARK: "0.75",
        // Sprint 2–6 opt-in — leave false until audit_obs soak justifies each flag.
        AUDIT_EARLY_PASS_TERMINATION: "false",
        AUDIT_SETTLE_SAFETY_NET_MS: "40000",
        AUDIT_SCROLL_ADAPT: "false",
        AUDIT_INCREMENTAL_REAUDIT: "false",
      },
      // 8 GB box: worker budget = Node.js ~600 MB + Chromium peak ~1,050 MB = ~1,650 MB.
      // Set restart at 2,500 MB to allow burst headroom without premature restarts.
      max_memory_restart: "2500M",
      kill_timeout: 120000,
    },
  ],
};
