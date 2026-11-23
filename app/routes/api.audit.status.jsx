import crypto from "node:crypto";
import { data } from "react-router";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { readAuditPages } from "../lib/store-sync.server";
import { maybeSweepStaleAuditStateForShop } from "../lib/audit-watchdog.server";
import { getShopQueueSnapshot } from "../lib/audit-queue-position.server";
import { auditErrorUserMessage } from "../lib/audit-user-messages.server";

const STATUS_SELECT = {
  auditRunning: true,
  auditComplete: true,
  auditFailed: true,
  auditError: true,
  auditPageIndex: true,
  auditTotalPages: true,
  auditPageStartedAt: true,
  auditPhase: true,
  auditPages: true,
  activeAuditJobId: true,
};

function statusEtag(body) {
  return `"${crypto.createHash("sha1").update(JSON.stringify(body)).digest("hex")}"`;
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  await maybeSweepStaleAuditStateForShop(session.shop).catch(() => {});

  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      configs: {
        select: STATUS_SELECT,
        take: 1,
      },
    },
  });

  const config = store?.configs?.[0];

  const pageIndex = config?.auditPageIndex ?? 0;
  const totalPages = config?.auditTotalPages ?? 0;
  const progress = totalPages > 0 ? Math.round((pageIndex / totalPages) * 100) : 0;

  const inProgress = config?.auditRunning && !config?.auditComplete && !config?.auditFailed;

  const queue =
    store?.id && config
      ? await getShopQueueSnapshot(store.id, config.activeAuditJobId, config.auditPhase)
      : null;

  const payload = {
    running: config?.auditRunning ?? false,
    complete: config?.auditComplete ?? false,
    failed: config?.auditFailed ?? false,
    error: config?.auditError ?? null,
    errorMessage: auditErrorUserMessage(config?.auditError),
    pageIndex,
    totalPages,
    progress,
    pages: inProgress ? readAuditPages(config?.auditPages) : [],
    pageStartedAt: config?.auditPageStartedAt ? config.auditPageStartedAt.toISOString() : null,
    phase: config?.auditPhase ?? null,
    queue,
    serverNow: Date.now(),
  };

  const etag = statusEtag(payload);
  const ifNone = request.headers.get("If-None-Match");
  if (ifNone && ifNone === etag) {
    return new Response(null, {
      status: 304,
      headers: { ETag: etag, "Cache-Control": "private, no-cache" },
    });
  }

  return data(payload, {
    headers: {
      ETag: etag,
      "Cache-Control": "private, no-cache",
    },
  });
}
