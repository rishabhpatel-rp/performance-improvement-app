import prisma from "../db.server";
import {
  INTERNAL_HEADER,
  internalAuthOk,
  json,
  readInternalSecret,
  readActorEmail,
} from "../lib/internal-request.ts";
import { parseCustomAuditUrl } from "../../shared/custom-audit-url.ts";
import { runCustomAudit } from "../lib/custom-audit.server.ts";
import { fireAndForget } from "../lib/logger.ts";

export const action = async ({ request }) => {
  if (request.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!internalAuthOk(request.headers.get(INTERNAL_HEADER), readInternalSecret())) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const parsed = parseCustomAuditUrl(body.url);
  if (!parsed.ok) return json({ ok: false, error: parsed.error }, 400);

  const password =
    typeof body.password === "string" && body.password.length <= 512 ? body.password : undefined;
  if (typeof body.password === "string" && body.password.length > 512) {
    return json({ ok: false, error: "That password is too long." }, 400);
  }

  const inFlight = await prisma.customAuditRun.count({
    where: { status: { in: ["queued", "running"] } },
  });
  if (inFlight > 0) {
    return json({ ok: false, error: "A scan is already running. Try again shortly." }, 409);
  }

  const run = await prisma.customAuditRun.create({
    data: {
      url: parsed.url,
      status: "queued",
      requestedBy: readActorEmail(body),
    },
    select: { id: true },
  });

  fireAndForget(runCustomAudit(run.id, parsed.url, password), "custom audit run");

  return json({ ok: true, runId: run.id });
};
