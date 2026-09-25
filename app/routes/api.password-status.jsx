import { authenticate } from "../shopify.server";
import prisma from "../db.server";

/**
 * GET /api/password-status
 *
 * The stored result of the background password-protection check
 * (app/lib/password-protection.server.ts). `checking` = no definite answer yet;
 * the dashboard polls this for a few seconds after load and shows the Step 1
 * password box when it returns `protected`.
 */
export async function loader({ request }) {
  const { session } = await authenticate.admin(request);

  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    select: { configs: { select: { isPasswordProtected: true }, take: 1 } },
  });
  const value = store?.configs?.[0]?.isPasswordProtected ?? null;

  return {
    state:
      value === true ? "protected" : value === false ? "not_protected" : "checking",
  };
}
