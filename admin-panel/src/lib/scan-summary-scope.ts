/** Mirror of app/lib/scan-summary-scope.js — keep in sync; parity tests cover it. */

export function tabDropdownAction(
  tabLists: {
    defer?: string[];
    auditDeferArray?: string[];
    first?: string[];
    firstUserDelayScripts?: string[];
    every?: string[];
    staticDeferDefaults?: string[];
  },
  token: string,
): string {
  const name = String(token || "").trim();
  const lists = tabLists || {};
  if ((lists.defer || lists.auditDeferArray || []).includes(name)) return "defer";
  if ((lists.first || lists.firstUserDelayScripts || []).includes(name)) return "delay_first";
  if ((lists.every || lists.staticDeferDefaults || []).includes(name)) return "delay_every";
  return "protected";
}

const PAGE_ROLES = ["home", "collection", "product"];

function roleFor(pageRoles: Record<string, string> | undefined, path: string) {
  if (!pageRoles || typeof pageRoles !== "object") return undefined;
  return pageRoles[path];
}

export type ScriptRow = {
  token: string;
  status?: string;
  pages?: string[];
  domain?: string;
  bytes?: number;
  kb?: number;
  homeRequestOrder?: number | null;
  homeStartMs?: number | null;
  durationMs?: number | null;
};

export function scriptsForScope(
  topScripts: ScriptRow[] | undefined,
  pageRoles: Record<string, string> | undefined,
  scope: string,
): ScriptRow[] {
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
