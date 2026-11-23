/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import { WORKER_HEARTBEAT_STALE_MS } from "./constants.ts";

export function heartbeatIsFresh(
  lastTickAt: any,
  nowMs = Date.now(),
  staleAfterMs: number = WORKER_HEARTBEAT_STALE_MS,
) {
  if (!lastTickAt) return false;
  return nowMs - new Date(lastTickAt).getTime() < staleAfterMs;
}

export function missingWorkerMessage() {
  return (
    "AUDIT_USE_DB_QUEUE is on but no audit worker heartbeat was seen recently. " +
    "Audits will be enqueued but never drained. Start the worker " +
    "(npm run docker-start-worker / pm2 start ecosystem.config.cjs)."
  );
}
