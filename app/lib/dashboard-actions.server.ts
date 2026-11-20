/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import { validateIntent } from "./action-schemas.ts";
/**
 * Merchant dashboard action dispatcher.
 *
 * `app._index.jsx` authenticates, enforces the admin lock and then hands the
 * form to `runDashboardIntent`. Each intent has exactly one implementation in
 * a `dashboard-actions-*` module; the admin-panel control plane reuses the same
 * handlers (see `api.internal.store-control.jsx`), so the two paths cannot
 * drift apart.
 */

import {
  handleToggleApp,
  handleStartAudit,
  handleStopAudit,
} from "./dashboard-actions-audit.server.ts";
import { handleSelectTheme } from "./dashboard-actions-theme.server.ts";
import {
  handleToggleScript,
  handleToggleAuditField,
  handleSaveAuditArrays,
  handleScriptTokenAction,
} from "./dashboard-actions-step2.server.ts";
import {
  handleSaveStorefrontPassword,
  handleSaveCustomPageUrls,
} from "./dashboard-actions-settings.server.ts";
import { handleMaybeFirstActivation } from "./first-activation.server.ts";

/** Every merchant intent mutates shop state, so every one honours the admin lock. */
const HANDLERS = {
  "toggle-app": handleToggleApp,
  "start-audit": handleStartAudit,
  "stop-audit": handleStopAudit,
  "select-theme": handleSelectTheme,
  "toggle-script": handleToggleScript,
  "toggle-audit-field": handleToggleAuditField,
  "save-audit-arrays": handleSaveAuditArrays,
  "script-token-action": handleScriptTokenAction,
  "save-storefront-password": handleSaveStorefrontPassword,
  "save-custom-page-urls": handleSaveCustomPageUrls,
  "maybe-first-activation": handleMaybeFirstActivation,
};

/** @param {unknown} intent */
export function isDashboardIntent(intent: any) {
  return typeof intent === "string" && Object.hasOwn(HANDLERS, intent);
}

/**
 * @param {{ admin: object, session: { shop: string }, formData: FormData }} args
 */
export async function runDashboardIntent({ admin, session, formData }: any) {
  const intent = formData.get("intent");
  if (!isDashboardIntent(intent)) return { ok: false, error: "Unknown intent." };
  const parsed = validateIntent(intent, formData);
  if (!parsed.ok) return { ok: false, error: "Invalid input.", fields: parsed.errors };
  return (HANDLERS as Record<string, any>)[intent]({ admin, session, formData });
}
