import prisma from "../db.server";
import {
  buildTemplateSavePatch,
  updateAuditArrays,
} from "./update-audit-config.server";

/** Admin panel entry: same persistence path as merchant `save-audit-arrays`. */
export async function adminSaveAuditArrays(
  shopDomain: string,
  rawPatch: Record<string, unknown>,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      configs: { take: 1 },
    },
  });
  if (!store) return null;

  const sc = store.configs[0] as Record<string, unknown> | undefined;
  const patch = buildTemplateSavePatch(sc, rawPatch);
  return updateAuditArrays(shopDomain, patch);
}
