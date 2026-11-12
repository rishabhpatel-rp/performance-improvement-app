import type { ActionFunctionArgs } from "react-router";
import { verifyAdminInternalRequest } from "../lib/admin-internal-auth.server";
import { safeLogActivity } from "../lib/dashboard-helpers.server";
import { adminSaveAuditArrays } from "../lib/admin-save-audit-config.server";
import { updateAuditFieldToggle } from "../lib/store-sync.server";
import {
  templateDelayFormKeys,
  templateListFormKeys,
} from "../lib/template-script-config";

const AUDIT_FIELDS = [
  "auditDeferArray",
  "auditHideSelectors",
  "staticDeferDefaults",
  "firstUserDelayScripts",
] as const;

type AuditField = (typeof AUDIT_FIELDS)[number];

const SAVE_KEYS = new Set([
  ...templateListFormKeys(),
  ...templateDelayFormKeys(),
  "firstUserDelayMs",
  "everyTimeDelayMs",
]);

function parseAdminSavePatch(
  source: Record<string, unknown>,
): Record<string, unknown> | null {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!SAVE_KEYS.has(key)) continue;
    patch[key] = value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return Response.json(
      { ok: false, error: "Method not allowed" },
      { status: 405 },
    );
  }

  if (!verifyAdminInternalRequest(request)) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const shopDomain =
    typeof body.shopDomain === "string" ? body.shopDomain.trim() : "";
  if (!shopDomain) {
    return Response.json(
      { ok: false, error: "shopDomain is required" },
      { status: 400 },
    );
  }

  const intent = body.intent;

  if (intent === "toggle-audit-field") {
    const field = body.field;
    const enabled = body.enabled === true;
    if (typeof field !== "string" || !AUDIT_FIELDS.includes(field as AuditField)) {
      return Response.json({ ok: false, error: "Invalid field" }, { status: 400 });
    }
    const result = await updateAuditFieldToggle(
      shopDomain,
      field as AuditField,
      enabled,
    );
    if (!result) {
      return Response.json({ ok: false, error: "Store not found" }, { status: 404 });
    }
    await safeLogActivity(
      shopDomain,
      "config_changed",
      `Admin panel: ${field} ${enabled ? "enabled" : "disabled"}`,
      { source: "admin-panel", changedFields: [field] },
    );
    return Response.json({ ok: true, field, enabled });
  }

  if (intent === "save-audit-arrays") {
    const raw =
      body.patch && typeof body.patch === "object"
        ? (body.patch as Record<string, unknown>)
        : body;
    const rawPatch = parseAdminSavePatch(raw);
    if (!rawPatch) {
      return Response.json({ ok: false, error: "No valid fields to save." }, { status: 400 });
    }

    try {
      const result = await adminSaveAuditArrays(shopDomain, rawPatch);
      if (!result) {
        return Response.json({ ok: false, error: "Store not found" }, { status: 404 });
      }

      await safeLogActivity(
        shopDomain,
        "config_changed",
        "Admin panel: template script lists updated (storefront rebuilt)",
        { source: "admin-panel", changedFields: Object.keys(rawPatch) },
      );

      return Response.json({ ok: true, saved: Object.keys(rawPatch) });
    } catch (err) {
      return Response.json(
        {
          ok: false,
          error: err instanceof Error ? err.message : "Save failed",
        },
        { status: 400 },
      );
    }
  }

  return Response.json({ ok: false, error: "Unknown intent" }, { status: 400 });
}
