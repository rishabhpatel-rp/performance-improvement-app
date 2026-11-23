/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import { applyStorefrontLists, toggleStorefrontFamily } from "./store-sync-audit.server";
import {
  familyFromField,
  isTemplateScope,
  scopeListColumn,
  scopeMsColumn,
} from "./storefront-lists";
import { loadStep2WriteEcho } from "./step2-config.server";
import { safeLogActivity, safeSyncConfig, safeUpdateConfig } from "./dashboard-helpers.server.ts";
import { applyScriptTokenAction } from "./step2-actions.server.ts";

const TOGGLE_FIELDS = new Set([
  "auditDeferArray",
  "auditHideSelectors",
  "staticDeferDefaults",
  "firstUserDelayScripts",
]);
const TOKEN_ACTIONS = new Set(["defer", "delay_first", "delay_every", "protected"]);
const LIST_KEYS = ["defer", "hide", "first", "every"];

/** Parses a JSON array of strings; `null` when the value is anything else. */
function parseJsonArray(raw: any) {
  try {
    const value = JSON.parse(raw || "[]");
    return Array.isArray(value) && value.every((x) => typeof x === "string") ? value : null;
  } catch {
    return null;
  }
}

/** A delay field: empty/absent is "not provided", otherwise a non-negative integer. */
function parseDelay(raw: any) {
  if (raw === null || raw === "") return { provided: false };
  const ms = parseInt(raw, 10);
  if (Number.isNaN(ms) || ms < 0)
    return { provided: true, error: "Delay must be zero or greater." };
  return { provided: true, ms };
}

const SCRIPT_KEYS = ["script1Enabled", "script2Enabled", "script3Enabled"];

/** Switches one of the three storefront scripts on or off. */
export async function handleToggleScript({ admin, session, formData }: any) {
  const scriptIndex = Number(formData.get("scriptIndex"));
  const enabled = formData.get("enabled") === "true";
  const key = SCRIPT_KEYS[scriptIndex];
  if (!key) return { ok: false, error: "Invalid script." };

  const config = await safeUpdateConfig(admin, { [key]: enabled });
  await safeSyncConfig(session.shop, config);
  await safeLogActivity(
    session.shop,
    "config_changed",
    `Script ${scriptIndex + 1} ${enabled ? "enabled" : "disabled"}`,
    { changedFields: [key] },
  );
  return { ok: true, config };
}

export async function handleToggleAuditField({ session, formData }: any) {
  const field = formData.get("field");
  const enabled = formData.get("enabled") === "true";
  if (typeof field !== "string" || !TOGGLE_FIELDS.has(field)) {
    return { ok: false, error: "Invalid field." };
  }
  const family = familyFromField(field);
  if (!family) return { ok: false, error: "Invalid field." };

  const result = await toggleStorefrontFamily(session.shop, family, enabled);
  if (!result) return { ok: false, error: "Store record not found." };

  await safeLogActivity(
    session.shop,
    "config_changed",
    `${field} ${enabled ? "enabled" : "disabled"}`,
    { changedFields: [field] },
  );

  const echo = await loadStep2WriteEcho(session.shop);
  return {
    ok: true,
    field,
    enabled,
    metafieldStatus: result.metafieldStatus,
    ...(echo ?? {}),
  };
}

/** DB-only writer for one tab's lists and delays. Nothing is written unless every field is valid. */
export async function handleSaveAuditArrays({ session, formData }: any) {
  const scope = String(formData.get("scope") || "global");
  if (!isTemplateScope(scope)) return { ok: false, error: "Invalid tab." };

  const patch: Record<string, any> = {};
  for (const name of LIST_KEYS) {
    const key = scopeListColumn(name as any, scope);
    if (!formData.has(key)) continue;
    const value = parseJsonArray(formData.get(key));
    if (value === null) {
      return {
        ok: false,
        error: "Each field must be a valid JSON array of strings.",
      };
    }
    patch[name] = value;
  }

  for (const [name, patchKey] of [
    ["first", "firstMs"],
    ["every", "everyMs"],
  ] as Array<[string, string]>) {
    const delay = parseDelay(formData.get(scopeMsColumn(name as any, scope)));
    if (delay.error) return { ok: false, error: delay.error };
    if (delay.provided) patch[patchKey] = delay.ms;
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: "No fields to save." };

  try {
    const result = await applyStorefrontLists(session.shop, scope, patch as any);
    if (!result) return { ok: false, error: "Store record not found." };

    const echoed: Record<string, any> = { metafieldStatus: result.metafieldStatus };
    for (const name of LIST_KEYS) {
      if (patch[name]) echoed[scopeListColumn(name as any, scope)] = patch[name];
    }
    if (patch.firstMs != null) echoed[scopeMsColumn("first", scope)] = patch.firstMs;
    if (patch.everyMs != null) echoed[scopeMsColumn("every", scope)] = patch.everyMs;

    const echo = await loadStep2WriteEcho(session.shop);
    return { ok: true, ...echoed, ...(echo ?? {}) };
  } catch (err) {
    console.error(
      "[Dashboard] Failed to save audit arrays:",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      error: "Failed to save. " + (err instanceof Error ? err.message : ""),
    };
  }
}

export async function handleScriptTokenAction({ session, formData }: any) {
  const token = String(formData.get("token") || "").trim();
  const actionName = String(formData.get("action") || "");
  const scope = String(formData.get("scope") || "global");
  if (!token) return { ok: false, error: "Missing script token." };
  if (!TOKEN_ACTIONS.has(actionName)) return { ok: false, error: "Invalid action." };
  if (!isTemplateScope(scope)) return { ok: false, error: "Invalid tab." };

  const result = await applyScriptTokenAction(session.shop, scope, token, actionName);
  if (!result.ok) return { ok: false, error: result.error };
  if (result.noop) return { ok: true, noop: true, token, action: actionName };

  await safeLogActivity(session.shop, "config_changed", `script action ${actionName} on ${token}`, {
    token,
    action: actionName,
  });
  const echo = await loadStep2WriteEcho(session.shop);
  return {
    ok: true,
    token,
    action: actionName,
    scope,
    ...result.patch,
    ...(echo ?? {}),
  };
}
