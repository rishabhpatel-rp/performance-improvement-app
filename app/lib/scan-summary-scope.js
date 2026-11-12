/** Dropdown value from this tab's lists only. A Global-only name stays "protected" here. */
export function tabDropdownAction(tabLists, token) {
  const name = String(token || "").trim();
  const lists = tabLists || {};
  if ((lists.defer || lists.auditDeferArray || []).includes(name)) return "defer";
  if ((lists.first || lists.firstUserDelayScripts || []).includes(name)) return "delay_first";
  if ((lists.every || lists.staticDeferDefaults || []).includes(name)) return "delay_every";
  return "protected";
}

/** Whether a header matches the shared internal secret. Missing secret never matches. */
export function internalAuthOk(headerValue, secret) {
  if (typeof secret !== "string" || secret.length === 0) return false;
  return headerValue === secret;
}

/** Which scan-summary rows belong on one tab. */

const PAGE_ROLES = ["home", "collection", "product"];

function roleFor(pageRoles, path) {
  if (!pageRoles || typeof pageRoles !== "object") return undefined;
  return pageRoles[path];
}

export function scriptsForScope(topScripts, pageRoles, scope) {
  const rows = Array.isArray(topScripts) ? topScripts : [];
  if (scope === "global") {
    const present = [
      ...new Set(
        Object.values(pageRoles || {}).filter((role) => PAGE_ROLES.includes(role)),
      ),
    ];
    if (!present.length) return rows;
    return rows.filter((row) => {
      const have = new Set(
        (row.pages || []).map((path) => roleFor(pageRoles, path)).filter(Boolean),
      );
      return present.every((role) => have.has(role));
    });
  }
  const want =
    scope === "collection" ? "collection" : scope === "product" ? "product" : "home";
  return rows.filter((row) =>
    (row.pages || []).some((path) => roleFor(pageRoles, path) === want),
  );
}
