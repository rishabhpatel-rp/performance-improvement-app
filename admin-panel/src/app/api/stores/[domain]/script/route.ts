import { forwardMerchantWrite } from "@/lib/merchant-route";

const INTENTS: readonly string[] = ["save-lists", "toggle", "script-token-action", "resync"];

export function POST(request: Request, ctx: { params: Promise<{ domain: string }> }) {
  return forwardMerchantWrite(request, ctx, {
    path: "/api/internal/storefront-lists",
    limit: { name: "script-write", max: 30 },
    requireActiveStore: true,
    validate: (body) =>
      typeof body.intent === "string" && INTENTS.includes(body.intent)
        ? null
        : `Unsupported intent: ${String(body.intent ?? "")}`,
  });
}
