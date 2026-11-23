import {
  json,
  internalAuthOk,
  readInternalSecret,
  INTERNAL_HEADER,
} from "../lib/internal-request.ts";
import { getAuditQueueMetrics } from "../lib/audit-metrics-snapshot.server";

/** Queue depth, drain tick, and memory snapshot for admin / ops (POST + internal secret). */
export async function action({ request }) {
  if (request.method !== "POST") {
    return json({ ok: false, error: "POST only" }, 405);
  }
  const secret = readInternalSecret();
  if (!internalAuthOk(request.headers.get(INTERNAL_HEADER), secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const metrics = await getAuditQueueMetrics();
  return json(metrics);
}
