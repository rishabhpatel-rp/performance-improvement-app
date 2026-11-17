function merchantUrl(): string {
  return (
    process.env.PAGEPULSE_INTERNAL_URL ||
    process.env.PAGEPULSE_APP_URL ||
    ""
  ).trim();
}

/** Server-only: warn when admin likely points at itself or localhost without merchant URL. */
export default function BridgeHint() {
  const url = merchantUrl();
  const secret =
    (process.env.INTERNAL_API_SECRET || process.env.ADMIN_INTERNAL_SECRET || "").length >
    0;
  const looksLikeAdmin =
    /localhost:3000|127\.0\.0\.1:3000|192\.168\.\d+\.\d+:3000/.test(url);
  if (secret && url && !looksLikeAdmin) return null;
  return (
    <div
      className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"
      role="status"
    >
      {!secret && "Set ADMIN_INTERNAL_SECRET / INTERNAL_API_SECRET. "}
      {(!url || looksLikeAdmin) &&
        "Set PAGEPULSE_APP_URL to the merchant app (shopify app dev), not the admin port. Run: node scripts/sync-admin-merchant-url.mjs"}
    </div>
  );
}