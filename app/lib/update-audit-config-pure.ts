import {
  auditDeferColumn,
  auditHideColumn,
  firstUserDelayColumn,
  readBucketsFromRow,
  staticDeferColumn,
  templateDelayFormKeys,
  templateListFormKeys,
  unionTemplateLists,
} from "./template-script-config.ts";

const LIST_KEYS = new Set(templateListFormKeys());
const DELAY_KEYS = new Set(templateDelayFormKeys());

const UNION_KEYS = [
  "auditDeferArray",
  "auditHideSelectors",
  "staticDeferDefaults",
  "firstUserDelayScripts",
] as const;

export type AuditField = (typeof UNION_KEYS)[number];

export type AuditArrayPatch = Record<string, string[] | number | undefined>;

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((x) => typeof x === "string")
  );
}

function listToggleEnabled(
  key: string,
  toggleState: Record<AuditField, boolean>,
): boolean {
  if (key.startsWith("auditDefer")) return toggleState.auditDeferArray;
  if (key.startsWith("auditHide")) return toggleState.auditHideSelectors;
  if (key.startsWith("firstUserDelayScripts")) {
    return toggleState.firstUserDelayScripts;
  }
  if (key.startsWith("staticDeferDefaults")) {
    return toggleState.staticDeferDefaults;
  }
  return true;
}

export function recomputeUnionColumns(
  mergedRow: Record<string, unknown>,
): Pick<
  AuditArrayPatch,
  | "auditDeferArray"
  | "auditHideSelectors"
  | "firstUserDelayScripts"
  | "staticDeferDefaults"
> {
  return {
    auditDeferArray: unionTemplateLists(
      readBucketsFromRow(mergedRow, auditDeferColumn, "auditDeferArray"),
    ),
    auditHideSelectors: unionTemplateLists(
      readBucketsFromRow(mergedRow, auditHideColumn, "auditHideSelectors"),
    ),
    firstUserDelayScripts: unionTemplateLists(
      readBucketsFromRow(mergedRow, firstUserDelayColumn, "firstUserDelayScripts"),
    ),
    staticDeferDefaults: unionTemplateLists(
      readBucketsFromRow(mergedRow, staticDeferColumn, "staticDeferDefaults"),
    ),
  };
}

export function buildTemplateSavePatch(
  currentRow: Record<string, unknown> | null | undefined,
  rawPatch: Record<string, unknown>,
): AuditArrayPatch {
  const toggleState: Record<AuditField, boolean> = {
    auditDeferArray:
      (currentRow?.auditDeferArrayEnabled as boolean | undefined) ?? true,
    auditHideSelectors:
      (currentRow?.auditHideSelectorsEnabled as boolean | undefined) ?? true,
    staticDeferDefaults:
      (currentRow?.staticDeferDefaultsEnabled as boolean | undefined) ?? true,
    firstUserDelayScripts:
      (currentRow?.firstUserDelayScriptsEnabled as boolean | undefined) ?? true,
  };

  const partial: AuditArrayPatch = {};

  for (const key of LIST_KEYS) {
    if (rawPatch[key] === undefined) continue;
    const value = listToggleEnabled(key, toggleState)
      ? rawPatch[key]
      : [];
    if (!isStringArray(value)) {
      throw new Error(`Field ${key} must be a JSON array of strings.`);
    }
    partial[key] = value;
  }

  for (const delayKey of DELAY_KEYS) {
    if (rawPatch[delayKey] === undefined) continue;
    const ms = rawPatch[delayKey];
    if (typeof ms !== "number" || ms < 0 || Number.isNaN(ms)) {
      throw new Error(`Field ${delayKey} must be a non-negative number (ms).`);
    }
    partial[delayKey] = ms;
  }

  if (
    typeof rawPatch.firstUserDelayMs === "number" &&
    rawPatch.firstUserDelayMs >= 0
  ) {
    partial.firstUserDelayMs = rawPatch.firstUserDelayMs;
    partial.firstUserDelayMsGlobal = rawPatch.firstUserDelayMs;
  }
  if (
    typeof rawPatch.everyTimeDelayMs === "number" &&
    rawPatch.everyTimeDelayMs >= 0
  ) {
    partial.everyTimeDelayMs = rawPatch.everyTimeDelayMs;
  }

  if (Object.keys(partial).length === 0) {
    throw new Error("No fields to save.");
  }

  const mergedRow = { ...(currentRow || {}), ...partial };
  return { ...partial, ...recomputeUnionColumns(mergedRow) };
}

export const ALLOWED_PATCH_KEY_SET = new Set<string>([
  ...LIST_KEYS,
  ...DELAY_KEYS,
  ...UNION_KEYS,
  "firstUserDelayMs",
  "everyTimeDelayMs",
]);

export function isAllowedPatchKey(key: string): boolean {
  return ALLOWED_PATCH_KEY_SET.has(key);
}
