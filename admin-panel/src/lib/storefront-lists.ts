export const TEMPLATE_SCOPES = ["global", "home", "collection", "product"] as const;
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const SCOPE_META: Record<
  TemplateScope,
  { label: string; short: string; suffix: string; note: string }
> = {
  global: {
    label: "Global",
    short: "Global",
    suffix: "Global",
    note: "Every page also uses the Global lists.",
  },
  home: {
    label: "Home",
    short: "Home",
    suffix: "Home",
    note: "Home page only — Global lists still apply.",
  },
  collection: {
    label: "PLP / Collections",
    short: "PLP",
    suffix: "Collection",
    note: "Collection pages only — Global lists still apply.",
  },
  product: {
    label: "PDP / Products",
    short: "PDP",
    suffix: "Product",
    note: "Product pages only — Global lists still apply.",
  },
};

export type ListFamily = "defer" | "hide" | "first" | "every";
export type DelayKind = "first" | "every";

export const FAMILY_FIELD: Record<ListFamily, string> = {
  defer: "auditDeferArray",
  hide: "auditHideSelectors",
  first: "firstUserDelayScripts",
  every: "staticDeferDefaults",
};

export const ENABLED_FIELD: Record<ListFamily, string> = {
  defer: "auditDeferArrayEnabled",
  hide: "auditHideSelectorsEnabled",
  first: "firstUserDelayScriptsEnabled",
  every: "staticDeferDefaultsEnabled",
};

export function scopeListColumn(family: ListFamily, scope: TemplateScope): string {
  return `${FAMILY_FIELD[family]}${SCOPE_META[scope].suffix}`;
}

export function scopeMsColumn(kind: DelayKind, scope: TemplateScope): string {
  return kind === "first"
    ? `firstUserDelayMs${SCOPE_META[scope].suffix}`
    : `everyTimeDelayMs${SCOPE_META[scope].suffix}`;
}

export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

export function listToText(list: string[]): string {
  return list.join("\n");
}

export function parseListText(
  text: string,
): { ok: true; value: string[] } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: [] };

  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed) || parsed.some((x) => typeof x !== "string")) {
        return { ok: false, error: "JSON must be an array of strings." };
      }
      return { ok: true, value: [...new Set(parsed as string[])] };
    } catch {
      return { ok: false, error: "Invalid JSON array." };
    }
  }

  const value = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return { ok: true, value: [...new Set(value)] };
}

export function readDelayMs(
  config: Record<string, unknown> | null | undefined,
  kind: DelayKind,
  scope: TemplateScope,
  fallback: number,
): number {
  const scoped = config?.[scopeMsColumn(kind, scope)];
  if (typeof scoped === "number" && Number.isFinite(scoped) && scoped >= 0) {
    return scoped;
  }
  const union = config?.[kind === "first" ? "firstUserDelayMs" : "everyTimeDelayMs"];
  if (typeof union === "number" && Number.isFinite(union) && union >= 0) {
    return union;
  }
  return fallback;
}

export function delaySeconds(ms: number): number {
  return Math.floor(ms / 1000);
}

export function unionOf(
  config: Record<string, unknown> | null | undefined,
  family: ListFamily,
): string[] {
  const set = new Set<string>();
  for (const scope of TEMPLATE_SCOPES) {
    readStringList(config?.[scopeListColumn(family, scope)]).forEach((token) =>
      set.add(token),
    );
  }
  return [...set];
}
