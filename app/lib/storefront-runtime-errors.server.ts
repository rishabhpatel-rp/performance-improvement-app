import prisma from "../db.server";
import { logAuditEvent } from "./audit-logging.server.ts";

/** Persist storefront runtime error beacon samples. */
export async function recordStorefrontRuntimeErrors(
  shopDomain: string,
  errors: unknown[],
): Promise<void> {
  const sample = errors.slice(0, 10);
  if (!sample.length) return;

  const identifierRedeclare = sample.some((e) => {
    const msg =
      typeof e === "string"
        ? e
        : e && typeof e === "object" && "message" in e
          ? String((e as { message?: unknown }).message ?? "")
          : JSON.stringify(e);
    return /Identifier .+ has already been declared/i.test(msg);
  });

  logAuditEvent("storefront_runtime_errors", {
    shop: shopDomain,
    count: sample.length,
    sample: sample[0],
    // Sprint 1 §8.4 — theme JS deferred that shouldn't have been (Gate 4-C watch).
    identifierRedeclare,
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
