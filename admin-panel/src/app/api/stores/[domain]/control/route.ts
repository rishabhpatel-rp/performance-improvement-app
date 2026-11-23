import { forwardMerchantWrite } from "@/lib/merchant-route";
import { validateIntent } from "../../../../../../../shared/action-schemas.ts";

const INTENTS: readonly string[] = ["toggle-app", "start-audit", "stop-audit", "set-admin-managed"];

export function POST(request: Request, ctx: { params: Promise<{ domain: string }> }) {
  return forwardMerchantWrite(request, ctx, {
    path: "/api/internal/store-control",
    limit: { name: "store-control", max: 20 },
    validate: (body) => {
      if (typeof body.intent !== "string" || !INTENTS.includes(body.intent))
        return "Invalid intent.";
      if (body.intent === "toggle-app") {
        const fd = new FormData();
        fd.set("appEnabled", String(body.appEnabled));
        const parsed = validateIntent("toggle-app", fd);
        return parsed.ok ? null : String(Object.values(parsed.errors)[0] ?? "Invalid input.");
      }
      return null;
    },
  });
}
