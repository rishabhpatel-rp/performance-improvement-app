/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
/**
 * Pure scan-summary helpers shared with the browser bundle
 * (`AuditReportPanel.jsx`). Keep this module free of Node-only imports; the
 * internal-API auth helpers live in `internal-request.js`.
 */

/** Dropdown value from this tab's lists only. A Global-only name stays "protected" here. */
export function tabDropdownAction(tabLists: any, token: any) {
  const name = String(token || "").trim();
  const lists = tabLists || {};
  if ((lists.defer || lists.auditDeferArray || []).includes(name)) return "defer";
  if ((lists.first || lists.firstUserDelayScripts || []).includes(name)) return "delay_first";
  if ((lists.every || lists.staticDeferDefaults || []).includes(name)) return "delay_every";
  return "protected";
}

/** Which scan-summary rows belong on one tab. */

const PAGE_ROLES = ["home", "collection", "product"];

function roleFor(pageRoles: any, path: any) {
  if (!pageRoles || typeof pageRoles !== "object") return undefined;
  return pageRoles[path];
}

export function scriptsForScope(topScripts: any, pageRoles: any, scope: any) {
  const rows = Array.isArray(topScripts) ? topScripts : [];
  if (scope === "global") {
    const present = [
      ...new Set(
        Object.values(pageRoles || {}).filter((role) => PAGE_ROLES.includes(role as string)),
      ),
    ];
    if (!present.length) return rows;
    return rows.filter((row) => {
      const have = new Set(
        (row.pages || []).map((path: any) => roleFor(pageRoles, path)).filter(Boolean),
      );
      return present.every((role) => have.has(role));
    });
  }
  const want = scope === "collection" ? "collection" : scope === "product" ? "product" : "home";
  return rows.filter((row) =>
    (row.pages || []).some((path: any) => roleFor(pageRoles, path) === want),
  );
}
