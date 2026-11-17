import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

const SCRIPT_SNAPSHOT_MAX = 2000;

function truncateText(value: string | null | undefined, max = SCRIPT_SNAPSHOT_MAX) {
  if (value == null) return value ?? null;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

export type StoreEraseReason = "shop_redact" | "admin_manual" | "pm2_log_backfill";

/**
 * Snapshot then remove live store rows. Used by password-gated admin purge.
 * If archive insert fails, live data is left alone.
 */
export async function archiveStoreThenErase(
  shopDomain: string,
  opts: { reason: StoreEraseReason; actorEmail?: string | null },
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    include: {
      configs: true,
      activities: { orderBy: { createdAt: "desc" }, take: 200 },
      performanceScript: true,
    },
  });

  if (store?.isActive) {
    return { skipped: true as const, reason: "active" as const };
  }

  if (!store) {
    return { skipped: true as const, reason: "missing" as const };
  }

  const ps = store.performanceScript;
  const snapshot: Prisma.InputJsonValue = {
    partial: false,
    store: {
      id: store.id,
      shopifyShopId: store.shopifyShopId,
      shopDomain: store.shopDomain,
      shopName: store.shopName,
      email: store.email,
      country: store.country,
      countryName: store.countryName,
      city: store.city,
      address1: store.address1,
      address2: store.address2,
      zip: store.zip,
      timezone: store.timezone,
      ianaTimezone: store.ianaTimezone,
      currency: store.currency,
      locale: store.locale,
      shopifyPlan: store.shopifyPlan,
      totalProducts: store.totalProducts,
      totalOrders: store.totalOrders,
      createdAtShopify: store.createdAtShopify?.toISOString() ?? null,
      installedAt: store.installedAt.toISOString(),
      uninstalledAt: store.uninstalledAt?.toISOString() ?? null,
      isActive: store.isActive,
      currentScope: store.currentScope,
      lastSyncedAt: store.lastSyncedAt?.toISOString() ?? null,
      createdAt: store.createdAt.toISOString(),
      updatedAt: store.updatedAt.toISOString(),
    },
    configs: store.configs,
    activities: store.activities,
    performanceScript: ps
      ? {
          id: ps.id,
          storeId: ps.storeId,
          scriptHash: ps.scriptHash,
          scriptBuiltAt: ps.scriptBuiltAt?.toISOString() ?? null,
          metafieldHash: ps.metafieldHash,
          metafieldSyncedAt: ps.metafieldSyncedAt?.toISOString() ?? null,
          deferScript: truncateText(ps.deferScript),
          readableScript: truncateText(ps.readableScript),
          hiddenCss: truncateText(ps.hiddenCss),
          auditScript: truncateText(ps.auditScript),
        }
      : null,
  };

  const archive = await prisma.storeArchive.create({
    data: {
      shopDomain,
      shopifyShopId: store.shopifyShopId,
      shopName: store.shopName,
      email: store.email,
      snapshot,
      reason: opts.reason,
      actorEmail: opts.actorEmail ?? null,
      sourceStoreId: store.id,
      installedAt: store.installedAt,
      uninstalledAt: store.uninstalledAt,
      redactedAt: new Date(),
    },
  });

  await prisma.$transaction(async (tx) => {
    await tx.session.deleteMany({ where: { shop: shopDomain } });
    await tx.auditLog.deleteMany({ where: { domain: shopDomain } });
    // AuditJob / PsiSnapshot / AppTracking exist on shared DB; admin schema
    // may omit some models — use raw SQL so purge still cleans them.
    await tx.$executeRaw`DELETE FROM "PsiSnapshot" WHERE "shopDomain" = ${shopDomain}`;
    await tx.$executeRaw`DELETE FROM "AuditJob" WHERE "shopDomain" = ${shopDomain}`;
    await tx.$executeRaw`DELETE FROM "AppTracking" WHERE domain = ${shopDomain}`;
    await tx.performanceScript.deleteMany({ where: { storeId: store.id } });
    await tx.storeActivity.deleteMany({ where: { storeId: store.id } });
    await tx.storeConfig.deleteMany({ where: { storeId: store.id } });
    await tx.store.delete({ where: { id: store.id } });
  });

  return { skipped: false as const, archiveId: archive.id };
}

export async function listStoreArchives(opts: {
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 25));
  const search = opts.search?.trim();

  const where = search
    ? {
        OR: [
          { shopDomain: { contains: search, mode: "insensitive" as const } },
          { shopName: { contains: search, mode: "insensitive" as const } },
          { email: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [total, rows] = await Promise.all([
    prisma.storeArchive.count({ where }),
    prisma.storeArchive.findMany({
      where,
      orderBy: { redactedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true,
        shopDomain: true,
        shopName: true,
        email: true,
        reason: true,
        actorEmail: true,
        installedAt: true,
        uninstalledAt: true,
        redactedAt: true,
        createdAt: true,
      },
    }),
  ]);

  return { total, page, pageSize, rows };
}
