import prisma from "../db.server";

export async function getAllowedStoreHosts(shopDomain: string): Promise<string[]> {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { primaryDomain: true },
  });
  return store?.primaryDomain ? [store.primaryDomain] : [];
}
