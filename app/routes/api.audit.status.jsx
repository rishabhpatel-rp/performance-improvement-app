import { authenticate } from "../shopify.server";
import prisma from "../db.server";

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

  return {
    running: config?.auditRunning ?? false,
    complete: config?.auditComplete ?? false,
    failed: config?.auditFailed ?? false,
    error: config?.auditError ?? null,
    pageIndex,
    totalPages,
    progress,
  };
}
