import { getDemoMode } from "@/lib/demo-mode";
import { readMerchantState } from "@/lib/merchant-route";
import { demoStateForDomain } from "@/lib/demo-state";
import { parseShopDomain } from "@/lib/shop-domain";

export async function GET(request: Request, ctx: { params: Promise<{ domain: string }> }) {
  if ((await getDemoMode()) === "on") {
    const domain = parseShopDomain((await ctx.params).domain);
    const demo = domain ? demoStateForDomain(domain) : null;
    return Response.json(demo ?? { ok: false, error: "No demo state for this store." }, {
      status: demo ? 200 : 404,
    });
  }
  return readMerchantState(ctx);
}
