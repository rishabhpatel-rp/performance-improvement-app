import { forwardMerchantWrite } from "@/lib/merchant-route";

export function POST(request: Request, ctx: { params: Promise<{ domain: string }> }) {
  return forwardMerchantWrite(request, ctx, {
    path: "/api/internal/admin-head-html",
    limit: { name: "admin-head", max: 15 },
    requireActiveStore: true,
    validate: (body) => {
      if (body.intent === "clear") return null;
      if (body.intent !== undefined && body.intent !== "save") {
        return "Invalid intent.";
      }
      return typeof body.html === "string" ? null : "html must be a string.";
    },
  });
}
