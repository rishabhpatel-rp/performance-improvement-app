import prisma from "../db.server";
import { startAuditForStore } from "./audit-runner.server";
import {
  normalizeCustomUrl,
  normalizeCustomUrlList,
} from "./page-urls.server";
import { rebuildPerformanceScript } from "./performance-script.server";
import { getPasswordProtection } from "./password-protection.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
  getSelectedThemeId,
  listThemes,
} from "./theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";
import {
  updateAuditArrays,
  updateAuditFieldToggle,
} from "./store-sync.server";
import {
  templateListFormKeys,
  templateDelayFormKeys,
  readBucketsFromRow,
  auditDeferColumn,
  auditHideColumn,
  firstUserDelayColumn,
  staticDeferColumn,
  unionTemplateLists,
} from "./template-script-config";
import {
  safeUpdateConfig,
  safeSyncConfig,
  safeLogActivity,
  disableAppBecauseEmbedOff,
} from "./dashboard-helpers.server.js";
import { stopAuditForShop } from "./audit-watchdog.server";
import {
  applyScopedTokenAction,
  storePatchFromTemplateLists,
} from "./audit-script-actions";

export async function handleToggleAuditField({ session, formData }) {
const field = formData.get("field");
const enabled = formData.get("enabled") === "true";
const allowed = [
  "auditDeferArray",
  "auditHideSelectors",
  "staticDeferDefaults",
  "firstUserDelayScripts",
];
if (typeof field !== "string" || !allowed.includes(field)) {
  return { ok: false, error: "Invalid field." };
}

const result = await updateAuditFieldToggle(session.shop, field, enabled);
if (!result) {
  return { ok: false, error: "Store record not found." };
}

await safeLogActivity(
  session.shop,
  "config_changed",
  `${field} ${enabled ? "enabled" : "disabled"}`,
  { changedFields: [field] },
);

return { ok: true, field, enabled };
}

export async function handleScriptTokenAction({ session, formData }) {
const token = String(formData.get("token") || "").trim();
const action = String(formData.get("action") || "keep");
const scopeRaw = String(formData.get("scope") || "global");
const scope = ["global", "home", "collection", "product"].includes(scopeRaw)
  ? scopeRaw
  : "global";
if (!token) {
  return { ok: false, error: "Missing script token." };
}
const storeRow = await prisma.store.findUnique({
  where: { shopDomain: session.shop },
  select: {
    configs: {
      select: {
        auditDeferArrayEnabled: true,
        firstUserDelayScriptsEnabled: true,
        staticDeferDefaultsEnabled: true,
        auditDeferGlobal: true,
        auditDeferHome: true,
        auditDeferCollection: true,
        auditDeferProduct: true,
        auditHideGlobal: true,
        auditHideHome: true,
        auditHideCollection: true,
        auditHideProduct: true,
        firstUserDelayScriptsGlobal: true,
        firstUserDelayScriptsHome: true,
        firstUserDelayScriptsCollection: true,
        firstUserDelayScriptsProduct: true,
        staticDeferDefaultsGlobal: true,
        staticDeferDefaultsHome: true,
        staticDeferDefaultsCollection: true,
        staticDeferDefaultsProduct: true,
      },
    },
  },
});
const sc = storeRow?.configs?.[0];
if (!sc) {
  return { ok: false, error: "Store config not found." };
}
if (!(sc.auditDeferArrayEnabled ?? true)) {
  return { ok: false, error: "Defer lists are disabled in Step 2." };
}
const row = sc;
const defer = readBucketsFromRow(row, auditDeferColumn, "auditDeferArray");
const hide = readBucketsFromRow(row, auditHideColumn, "auditHideSelectors");
const first = readBucketsFromRow(row, firstUserDelayColumn, "firstUserDelayScripts");
const every = readBucketsFromRow(row, staticDeferColumn, "staticDeferDefaults");
const updated = applyScopedTokenAction(defer, first, every, scope, token, action);
if (!updated) {
  return { ok: true, noop: true, token, action, scope };
}
const patch = storePatchFromTemplateLists(
  updated.defer,
  hide,
  updated.first,
  updated.every,
);
try {
  const result = await updateAuditArrays(session.shop, patch);
  if (!result) {
    return { ok: false, error: "Store record not found." };
  }
  await safeLogActivity(session.shop, "config_changed", `script action ${action} on ${token}`, {
    token,
    action,
  });
  return { ok: true, token, action, scope, ...patch };
} catch (err) {
  return {
    ok: false,
    error: err instanceof Error ? err.message : "Save failed",
  };
}
}

export async function handleSaveAuditArrays({ session, formData }) {
const parseJsonArray = (raw) => {
  try {
    const v = JSON.parse(raw || "[]");
    if (Array.isArray(v) && v.every((x) => typeof x === "string")) {
      return v;
    }
    return null;
  } catch {
    return null;
  }
};

// If a field's toggle is OFF, force the stored value to [] regardless of
// what was submitted (the real data stays in the preserved column).
const storeRow = await prisma.store.findUnique({
  where: { shopDomain: session.shop },
  select: {
    id: true,
    configs: {
      select: {
        auditDeferArrayEnabled: true,
        auditHideSelectorsEnabled: true,
        staticDeferDefaultsEnabled: true,
        // Without this, `sc.firstUserDelayScriptsEnabled` is always
        // undefined and the toggle-OFF -> [] coercion below can never
        // apply to firstUserDelayScripts (the ?? true fallback wins).
        firstUserDelayScriptsEnabled: true,
      },
    },
  },
});
const sc = storeRow?.configs?.[0];
const toggleState = {
  auditDeferArray: sc?.auditDeferArrayEnabled ?? true,
  auditHideSelectors: sc?.auditHideSelectorsEnabled ?? true,
  staticDeferDefaults: sc?.staticDeferDefaultsEnabled ?? true,
  firstUserDelayScripts: sc?.firstUserDelayScriptsEnabled ?? true,
};

const patch = {};
const listToggleEnabled = (key) => {
  if (key.startsWith("auditDefer")) return toggleState.auditDeferArray;
  if (key.startsWith("auditHide")) return toggleState.auditHideSelectors;
  if (key.startsWith("firstUserDelayScripts")) return toggleState.firstUserDelayScripts;
  if (key.startsWith("staticDeferDefaults")) return toggleState.staticDeferDefaults;
  return true;
};
for (const key of templateListFormKeys()) {
  if (!formData.has(key)) continue;
  const value = listToggleEnabled(key) ? parseJsonArray(formData.get(key)) : [];
  if (value === null) {
    return {
      ok: false,
      error: "Each field must be a valid JSON array of strings.",
    };
  }
  patch[key] = value;
}

for (const delayKey of templateDelayFormKeys()) {
  if (!formData.has(delayKey)) continue;
  const raw = formData.get(delayKey);
  if (raw === null || raw === "") continue;
  const ms = parseInt(raw, 10);
  if (!Number.isNaN(ms) && ms >= 0) patch[delayKey] = ms;
}

const firstUserDelayMs = formData.get("firstUserDelayMs");
const everyTimeDelayMs = formData.get("everyTimeDelayMs");

if (firstUserDelayMs !== null && firstUserDelayMs !== "") {
  const ms = parseInt(firstUserDelayMs, 10);
  if (!isNaN(ms) && ms >= 0) {
    patch.firstUserDelayMs = ms;
    patch.firstUserDelayMsGlobal = ms;
  }
}

if (everyTimeDelayMs !== null && everyTimeDelayMs !== "") {
  const ms = parseInt(everyTimeDelayMs, 10);
  if (!isNaN(ms) && ms >= 0) {
    patch.everyTimeDelayMs = ms;
  }
}

if (Object.keys(patch).length === 0) {
  return { ok: false, error: "No fields to save." };
}

const mergedRow = { ...(sc || {}), ...patch };
patch.auditDeferArray = unionTemplateLists(
  readBucketsFromRow(mergedRow, auditDeferColumn, "auditDeferArray"),
);
patch.auditHideSelectors = unionTemplateLists(
  readBucketsFromRow(mergedRow, auditHideColumn, "auditHideSelectors"),
);
patch.firstUserDelayScripts = unionTemplateLists(
  readBucketsFromRow(mergedRow, firstUserDelayColumn, "firstUserDelayScripts"),
);
patch.staticDeferDefaults = unionTemplateLists(
  readBucketsFromRow(mergedRow, staticDeferColumn, "staticDeferDefaults"),
);

try {
  const result = await updateAuditArrays(session.shop, patch);
  if (!result) {
    return { ok: false, error: "Store record not found." };
  }
  return { ok: true, ...patch };
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
