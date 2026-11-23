const SHOP_DOMAIN = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

/** Returns the normalised shop domain, or null when it is not a myshopify domain. */
export function parseShopDomain(raw: string): string | null {
  const domain = raw.trim().toLowerCase();
  return SHOP_DOMAIN.test(domain) ? domain : null;
}
