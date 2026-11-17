import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { buildStep2Version } from "../lib/step2-config.server";

/** Lightweight change detector for Step 2 polling (config + script hash). */
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    include: { configs: { take: 1 }, performanceScript: true },
  });
  const sc = store?.configs?.[0];
  const version = buildStep2Version(store, sc, store?.performanceScript);
  return version;
}
