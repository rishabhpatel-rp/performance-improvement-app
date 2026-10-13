import prisma from "../db.server";
import { readStringArray } from "./performance-script.server";
import { templateBucketsToStorePatch } from "./template-script-config";
import { auditDeferColumn, TEMPLATE_SCOPES } from "./template-script-config";
import type { HiddenAuditResult } from "./audit.server";
import { rebuildPerformanceScript } from "./performance-script.server";

export function storeNeedsTemplateHeal(
  sc: Record<string, unknown> | null | undefined,
): boolean {
  if (!sc) return false;
  return !TEMPLATE_SCOPES.some(
    (scope) => readStringArray(sc[auditDeferColumn(scope)]).length > 0,
  );
}

export async function healStoreTemplateFromReport(
  shopDomain: string,
  report: HiddenAuditResult,
): Promise<boolean> {
  if (!report.templateBuckets?.defer || !report.templateBuckets?.hide) return false;

  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      configs: {
        select: {
          auditDeferGlobal: true,
          auditDeferHome: true,
          auditDeferCollection: true,
          auditDeferProduct: true,
        },
      },
    },
  });
  const sc = store?.configs?.[0] as Record<string, unknown> | undefined;
  if (!store || !sc || !storeNeedsTemplateHeal(sc)) return false;

  const patch = templateBucketsToStorePatch(
    report.templateBuckets.defer,
    report.templateBuckets.hide,
  );
  await prisma.storeConfig.update({
    where: { storeId: store.id },
    data: patch,
  });
  await rebuildPerformanceScript(shopDomain);
  console.log(`[heal] Synced template defer/hide columns from latest audit for ${shopDomain}`);
  return true;
}
