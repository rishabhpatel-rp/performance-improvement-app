/**
 * Shared secret between the internal admin panel and this app. Used only for
 * server-to-server calls that run rebuildPerformanceScript (needs Shopify
 * offline sessions stored here).
 */
export function verifyAdminInternalRequest(request: Request): boolean {
  const expected = process.env.ADMIN_INTERNAL_SECRET?.trim();
  if (!expected || expected.length < 16) {
    console.error(
      "[admin-internal] ADMIN_INTERNAL_SECRET is missing or too short — rejecting request.",
    );
    return false;
  }
  const auth = request.headers.get("Authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return match[1].trim() === expected;
}
