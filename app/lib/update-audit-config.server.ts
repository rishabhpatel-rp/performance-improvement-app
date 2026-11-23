import { DEFAULT_DELAY_SCRIPTS, FIRST_USER_DELAY_MS, EVERY_TIME_DELAY_MS } from "./constants.ts";
import prisma from "../db.server";
import { rebuildPerformanceScript, readStringArray } from "./performance-script.server";
import {
  type AuditArrayPatch,
  type AuditField,
  isAllowedPatchKey,
} from "./update-audit-config-pure";
import { templateDelayFormKeys, templateListFormKeys } from "./template-script-config.ts";

import { logger } from "./logger.ts";
export const DEFAULT_STATIC_DEFER = [...DEFAULT_DELAY_SCRIPTS];

export type { AuditArrayPatch, AuditField } from "./update-audit-config-pure";
export {} from "./update-audit-config-pure";

const LIST_KEYS = new Set(templateListFormKeys());
const UNION_KEYS = [
  "auditDeferArray",
  "auditHideSelectors",
  "staticDeferDefaults",
  "firstUserDelayScripts",
] as const;

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((x) => typeof x === "string");
}

function sanitizePatch(patch: AuditArrayPatch): AuditArrayPatch {
  const out: AuditArrayPatch = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!isAllowedPatchKey(key) || value === undefined) continue;
    if (LIST_KEYS.has(key) || UNION_KEYS.includes(key as AuditField)) {
      if (!isStringArray(value)) {
        throw new Error(`Field ${key} must be a JSON array of strings.`);
      }
      out[key] = value;
    } else if (
      templateDelayFormKeys().includes(key) ||
      key === "firstUserDelayMs" ||
      key === "everyTimeDelayMs"
    ) {
      if (typeof value !== "number" || value < 0 || Number.isNaN(value)) {
        throw new Error(`Field ${key} must be a non-negative number (ms).`);
      }
      out[key] = value;
    }
  }
  return out;
}

export async function updateAuditArrays(shopDomain: string, patch: AuditArrayPatch) {
  const sanitized = sanitizePatch(patch);
  if (Object.keys(sanitized).length === 0) {
    throw new Error("No fields to save.");
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });
  if (!store) {
    logger.warn(`[updateAuditArrays] No store found for ${shopDomain}. Skipped.`);
    return null;
  }

  const createData: AuditArrayPatch = {
    auditDeferArray: sanitized.auditDeferArray ?? [],
    auditHideSelectors: sanitized.auditHideSelectors ?? [],
    staticDeferDefaults: sanitized.staticDeferDefaults ?? DEFAULT_STATIC_DEFER,
    firstUserDelayScripts: sanitized.firstUserDelayScripts ?? [...DEFAULT_DELAY_SCRIPTS],
    firstUserDelayMs: sanitized.firstUserDelayMs ?? FIRST_USER_DELAY_MS,
    everyTimeDelayMs: sanitized.everyTimeDelayMs ?? EVERY_TIME_DELAY_MS,
  };

  const result = await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      appEnabled: false,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      ...createData,
      ...Object.fromEntries(Object.entries(sanitized).filter(([, v]) => v !== undefined)),
    },
    update: Object.fromEntries(Object.entries(sanitized).filter(([, v]) => v !== undefined)),
  });

  await rebuildPerformanceScript(shopDomain);
  return result;
}

const TOGGLE_FIELD_MAP: Record<
  AuditField,
  {
    enabledKey:
      | "auditDeferArrayEnabled"
      | "auditHideSelectorsEnabled"
      | "staticDeferDefaultsEnabled"
      | "firstUserDelayScriptsEnabled";
    preservedKey:
      | "auditDeferArrayPreserved"
      | "auditHideSelectorsPreserved"
      | "staticDeferDefaultsPreserved"
      | "firstUserDelayScriptsPreserved";
  }
> = {
  auditDeferArray: {
    enabledKey: "auditDeferArrayEnabled",
    preservedKey: "auditDeferArrayPreserved",
  },
  auditHideSelectors: {
    enabledKey: "auditHideSelectorsEnabled",
    preservedKey: "auditHideSelectorsPreserved",
  },
  staticDeferDefaults: {
    enabledKey: "staticDeferDefaultsEnabled",
    preservedKey: "staticDeferDefaultsPreserved",
  },
  firstUserDelayScripts: {
    enabledKey: "firstUserDelayScriptsEnabled",
    preservedKey: "firstUserDelayScriptsPreserved",
  },
};

export async function updateAuditFieldToggle(
  shopDomain: string,
  field: AuditField,
  enabled: boolean,
) {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) return null;

  const current = await prisma.storeConfig.findUnique({
    where: { storeId: store.id },
  });

  const { enabledKey, preservedKey } = TOGGLE_FIELD_MAP[field];
  const active = readStringArray(current ? (current as Record<string, unknown>)[field] : undefined);
  const preserved = readStringArray(
    current ? (current as Record<string, unknown>)[preservedKey] : undefined,
  );

  const nextActive = enabled ? (preserved.length > 0 ? preserved : active) : [];
  const nextPreserved = enabled ? preserved : active;

  const seed = {
    storeId: store.id,
    appEnabled: false,
    script1Enabled: false,
    script2Enabled: false,
    script3Enabled: false,
    debugMode: false,
    scriptTitles: [],
  } as const;

  const result = await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      ...seed,
      [field]: nextActive,
      [enabledKey]: enabled,
      [preservedKey]: nextPreserved,
    },
    update: {
      [field]: nextActive,
      [enabledKey]: enabled,
      [preservedKey]: nextPreserved,
    },
  });

  await rebuildPerformanceScript(shopDomain);
  return result;
}
