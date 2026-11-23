import type { DiscoveredPages } from "./audit-core.ts";
import { safePathname } from "./audit-core.ts";
import type { AuditPageRole } from "./audit-template-buckets.ts";

/** Map audited pathnames to template roles for bucket splitting (D-2). */
export function buildPageRolesFromDiscovered(
  pages: DiscoveredPages,
  auditedPaths: string[],
): Record<string, AuditPageRole> {
  const homePath = safePathname(pages.home);
  const plpPath = pages.plp ? safePathname(pages.plp) : null;
  const pdpPath = pages.pdp ? safePathname(pages.pdp) : null;
  const out: Record<string, AuditPageRole> = {};
  for (const path of auditedPaths) {
    if (path === homePath || path === "/") {
      out[path] = "home";
    } else if (plpPath && path === plpPath) {
      out[path] = "collection";
    } else if (pdpPath && path === pdpPath) {
      out[path] = "product";
    } else if (path.startsWith("/collections/")) {
      out[path] = "collection";
    } else if (path.startsWith("/products/")) {
      out[path] = "product";
    } else {
      out[path] = "extra";
    }
  }
  return out;
}
