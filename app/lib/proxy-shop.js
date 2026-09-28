// Decides which shop an App Proxy request is allowed to read data for.
//
// SECURITY: only the shop from the verified App Proxy session is trusted.
// Never fall back to a `shop` query param — it is unsigned and attacker
// controlled (audit finding H2, REMEDIATION Task 2).
export function resolveVerifiedProxyShop(auth) {
  const shop = auth?.session?.shop;
  return typeof shop === "string" && shop.length > 0 ? shop : null;
}
