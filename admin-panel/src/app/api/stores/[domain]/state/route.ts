import { NextResponse } from "next/server";
import {
  isRecord,
  jsonNetworkFailure,
  jsonUpstreamFailure,
  postMerchant,
  requireMerchantSession,
} from "@/lib/merchant-route";

export async function GET(
  _request: Request,
  ctx: { params: Promise<{ domain: string }> },
) {
  const { unauthorized } = await requireMerchantSession("viewer");
  if (unauthorized) return unauthorized;

  const { domain } = await ctx.params;
  const shopDomain = decodeURIComponent(domain);

  const { res, data, error } = await postMerchant("/api/internal/storefront-state", {
    shopDomain,
  });
  if (error) return jsonNetworkFailure(error);
  if (!isRecord(data) || data.ok !== true) {
    return jsonUpstreamFailure(data, res!);
  }
  return NextResponse.json(data);
}