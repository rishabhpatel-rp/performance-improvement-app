import { registerAuditWatchdog } from "./audit-watchdog.server";
import {
  maybeStartWebFallbackDrain,
  registerAuditQueueDrain,
  registerAuditQueueShutdown,
} from "./audit-queue.server";
import { registerWorkerHeartbeat, warnIfNoWorkerOnBoot } from "./worker-heartbeat.server";
import { logger } from "./logger.ts";
import { auditWorkerDrainEnabled } from "./audit-env.server.ts";

let booted = false;

export function registerServerBoot(): void {
  if (booted) return;
  booted = true;

  registerAuditWatchdog();
  registerAuditQueueShutdown();
  registerAuditQueueDrain();
  registerWorkerHeartbeat();
  void maybeStartWebFallbackDrain().then(() => {
    if (!auditWorkerDrainEnabled()) warnIfNoWorkerOnBoot();
  });
  const fallbackCheck = setInterval(() => void maybeStartWebFallbackDrain(), 30_000);
  fallbackCheck.unref();

  process.on("unhandledRejection", (reason) => {
    logger.error("[boot] unhandledRejection:", reason);
  });

  process.on("uncaughtException", (err) => {
    logger.error("[boot] uncaughtException:", err);
  });
}

registerServerBoot();
