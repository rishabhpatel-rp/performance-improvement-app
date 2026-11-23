/** Must be imported before boot.server so getEnv() sees worker mode. */
process.env.AUDIT_WORKER_ENABLED = "true";
process.env.AUDIT_USE_DB_QUEUE = process.env.AUDIT_USE_DB_QUEUE ?? "true";
