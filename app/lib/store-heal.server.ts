import prisma from "../db.server";

/**
 * After reinstall, APP_UNINSTALLED may have set isActive=false while a new
 * offline session exists. Heal so metafield sync and reconcile run again.
 */
export async function healStoreIfReinstalled(shopDomain: string): Promise<boolean> {
  const session = await prisma.session.findFirst({
    where: { shop: shopDomain, isOnline: false },
    select: { id: true },
  });
  if (!session) return false;

  const updated = await prisma.store.updateMany({
    where: { shopDomain, isActive: false },
    data: { isActive: true, uninstalledAt: null },
  });
  if (updated.count > 0) {
    console.log(`[store-heal] reactivated ${shopDomain} (offline session present)`);
  }
  return updated.count > 0;
}
