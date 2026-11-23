/** Data retention (CQ-12). Logs expire after 90 days; at least the latest 20
 *  audits per shop are always kept so the report UI still has history. */

export const RETENTION_DAYS = 90;
export const MIN_AUDITS_PER_SHOP = 20;
export const DAY_MS = 24 * 60 * 60 * 1000;

export function retentionCutoffs(now = Date.now()) {
  return {
    logsBefore: new Date(now - RETENTION_DAYS * DAY_MS),
    jobsBefore: new Date(now - RETENTION_DAYS * DAY_MS),
    snapshotsBefore: new Date(now - RETENTION_DAYS * DAY_MS),
    keepAuditsPerShop: MIN_AUDITS_PER_SHOP,
  };
}

export async function runRetentionCleanup(
  db: {
    auditLog: {
      count: (a: object) => Promise<number>;
      deleteMany: (a: object) => Promise<{ count: number }>;
      findMany: (a: object) => Promise<Array<{ id: number; domain: string }>>;
    };
    storeActivity: { deleteMany: (a: object) => Promise<{ count: number }> };
    auditJob: { deleteMany: (a: object) => Promise<{ count: number }> };
    psiSnapshot: { deleteMany: (a: object) => Promise<{ count: number }> };
  },
  now = Date.now(),
) {
  const c = retentionCutoffs(now);
  const result: Record<string, number> = {};

  result.auditLog = (
    await db.auditLog.deleteMany({ where: { timestamp: { lt: c.logsBefore } } })
  ).count;
  result.storeActivity = (
    await db.storeActivity.deleteMany({ where: { createdAt: { lt: c.logsBefore } } })
  ).count;
  result.auditJob = (
    await db.auditJob.deleteMany({ where: { createdAt: { lt: c.jobsBefore } } })
  ).count;
  result.psiSnapshot = (
    await db.psiSnapshot.deleteMany({ where: { fetchedAt: { lt: c.snapshotsBefore } } })
  ).count;

  // Remove only audits beyond the newest N per shop.
  const domains = await db.auditLog.findMany({
    where: { timestamp: { lt: c.logsBefore } },
    select: { domain: true },
  });
  const uniqueDomains = [...new Set(domains.map((r: { domain: string }) => r.domain))];
  result.oldAuditsBeyondMinimum = 0;
  for (const domain of uniqueDomains) {
    const count = await db.auditLog.count({ where: { domain } });
    if (count <= c.keepAuditsPerShop) continue;
    const keep = await db.auditLog.findMany({
      where: { domain },
      orderBy: { timestamp: "desc" },
      select: { id: true },
      take: c.keepAuditsPerShop,
    });
    const keepIds = keep.map((r: { id: number }) => r.id);
    const deleted = await db.auditLog.deleteMany({
      where: { domain, id: { notIn: keepIds } },
    });
    result.oldAuditsBeyondMinimum += deleted.count;
  }
  return result;
}
