import prisma from "../db.server";
import { logAuditEvent } from "./audit-logging.server.ts";

/** Persist storefront runtime error beacon samples. */
export async function recordStorefrontRuntimeErrors(
  shopDomain: string,
  errors: unknown[],
): Promise<void> {
  const sample = errors.slice(0, 10);
  if (!sample.length) return;

  logAuditEvent("storefront_runtime_errors", {
    shop: shopDomain,
    count: sample.length,
    sample: sample[0],
  });

  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) return;

  await prisma.auditLog.create({
    data: {
      domain: shopDomain,
      audit_type: "runtime-errors",
      audit_data: { errors: sample, rate: sample.length / 10 },
      status: "completed",
      details: null,
    },
  });
}
