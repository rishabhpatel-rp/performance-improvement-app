/**
 * PM2 layout for PagePulse (audit-system-health-plan Phase 4).
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
      },
      max_memory_restart: "800M",
    },
    {
      name: "pagepulse-audit-worker",
      cwd: __dirname,
      script: "npm",
      args: "run worker", // tsx is a root dependency; no runtime download
      env: {
        AUDIT_USE_DB_QUEUE: "true",
        AUDIT_WORKER_ENABLED: "true",
      },
      max_memory_restart: "1800M",
      kill_timeout: 120000,
    },
  ],
};
