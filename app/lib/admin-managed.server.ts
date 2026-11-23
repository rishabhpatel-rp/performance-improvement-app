/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import prisma from "../db.server";

/** When true, merchant embedded app must not mutate config (admin control plane). */
export async function isAdminManaged(shopDomain: any) {
  const row = await prisma.storeConfig.findFirst({
    where: { store: { shopDomain } },
    select: { adminManaged: true },
  });
  return row?.adminManaged === true;
}

export async function setAdminManaged(shopDomain: any, adminManaged: any) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true },
  });
  if (!store) return false;
  await prisma.storeConfig.updateMany({
    where: { storeId: store.id },
    data: { adminManaged: adminManaged === true },
  });
  return true;
}

/** Auto-lock shop when admin panel writes config. */
export async function ensureAdminManaged(shopDomain: any) {
  await setAdminManaged(shopDomain, true);
}

const MERCHANT_BLOCKED = {
  ok: false,
  error: "admin_managed",
  message:
    "This store is managed from the PagePulse admin panel. Open a support ticket if you need changes here.",
};

/** Block merchant dashboard mutations when adminManaged is on. */
export async function assertMerchantCanMutate(shopDomain: any) {
  if (await isAdminManaged(shopDomain)) {
    return MERCHANT_BLOCKED;
  }
  return null;
}
