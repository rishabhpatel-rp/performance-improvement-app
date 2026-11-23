import "./worker-env.ts";
import "../lib/boot.server";
import { recoverAuditJobsOnBoot, registerAuditQueueDrain } from "../lib/audit-queue.server";
import { AUDIT_DRAIN_POLL_MS } from "../lib/audit-env.server";
import { registerWorkerHeartbeat } from "../lib/worker-heartbeat.server";
import { logger } from "../lib/logger.js";

async function main() {
  logger.info("[audit-worker] starting drain loop");
  await recoverAuditJobsOnBoot();
  registerAuditQueueDrain();
  registerWorkerHeartbeat();
  setInterval(() => {
    logger.debug("[audit-worker] tick");
  }, AUDIT_DRAIN_POLL_MS * 6);
}

main().catch((err) => {
  logger.error("[audit-worker] fatal", err);
  process.exit(1);
});
