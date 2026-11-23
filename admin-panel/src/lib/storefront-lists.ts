export type TemplateScope = "global" | "home" | "collection" | "product";

const SCOPE_META: Record<
  TemplateScope,
  { label: string; short: string; suffix: string; note: string }
> = {
  global: {
    label: "Global",
    short: "Global",
    suffix: "Global",
    note: "Defer/hide: names here apply on every template. Delay boxes: saving here also sets Home, PLP, and PDP until you edit those tabs.",
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

type ListFamily = "defer" | "hide" | "first" | "every";

const FAMILY_FIELD: Record<ListFamily, string> = {
  defer: "auditDeferArray",
  hide: "auditHideSelectors",
  first: "firstUserDelayScripts",
  every: "staticDeferDefaults",
};

export function scopeListColumn(family: ListFamily, scope: TemplateScope): string {
  return `${FAMILY_FIELD[family]}${SCOPE_META[scope].suffix}`;
}

export function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
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
