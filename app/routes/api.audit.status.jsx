import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { readAuditPages } from "../lib/store-sync.server";
import { auditProgressFlags } from "../lib/audit-lifecycle.ts";

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    include: { configs: true },
  });

  const config = store?.configs?.[0];

  const pageIndex = config?.auditPageIndex ?? 0;
  const totalPages = config?.auditTotalPages ?? 0;
  const progress =
    totalPages > 0 ? Math.round((pageIndex / totalPages) * 100) : 0;

  const flags = auditProgressFlags(config);
  return {
    running: flags.running,
    complete: flags.complete,
    failed: flags.failed,
    error: config?.auditError ?? null,
    pageIndex,
    totalPages,
    progress,
    pages: readAuditPages(config?.auditPages),
    pageStartedAt: config?.auditPageStartedAt
      ? config.auditPageStartedAt.toISOString()
      : null,
    phase: config?.auditPhase ?? null,
    serverNow: Date.now(),
  };
}
