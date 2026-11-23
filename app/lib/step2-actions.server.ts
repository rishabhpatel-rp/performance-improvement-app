/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import prisma from "../db.server";
import { applyStorefrontLists } from "./store-sync-audit.server";
import { buildArrayPatchForTokenAction } from "./audit-script-actions";
import { scopeListColumn } from "./storefront-lists";
import { readStringArray } from "./performance-script.server";

/**
 * Applies one scan-table "Defer / Delay first / Delay every / Keep" choice to
 * a single tab's lists. Shared by the merchant dashboard action and the
 * admin-panel internal route so both write exactly the same way.
 *
 * @param {string} shopDomain
 * @param {string} scope one of global | home | collection | product
 * @param {string} token script token the merchant clicked
 * @param {string} actionName defer | delay_first | delay_every | protected
 * @returns {Promise<
 *   | { ok: true, noop: true }
 *   | { ok: true, noop?: false, patch: object, metafieldStatus: string }
 *   | { ok: false, error: string, status: 400 | 404 }
 * >}
 */
export async function applyScriptTokenAction(
  shopDomain: any,
  scope: any,
  token: any,
  actionName: any,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    include: { configs: { take: 1 } },
  });
  const sc = store?.configs?.[0];
  if (!sc) return { ok: false, error: "Store config not found.", status: 404 };
  if (sc.auditDeferArrayEnabled === false && actionName === "defer") {
    return {
      ok: false,
      error: "Defer lists are disabled in Step 2.",
      status: 400,
    };
  }

  const patch = buildArrayPatchForTokenAction(
    {
      auditDeferArray: readStringArray(sc[scopeListColumn("defer", scope)]),
      firstUserDelayScripts: readStringArray(sc[scopeListColumn("first", scope)]),
      staticDeferDefaults: readStringArray(sc[scopeListColumn("every", scope)]),
    },
    token,
    actionName,
  );
  if (!patch) return { ok: true, noop: true };

  const result = await applyStorefrontLists(shopDomain, scope, {
    defer: patch.auditDeferArray,
    first: patch.firstUserDelayScripts,
    every: patch.staticDeferDefaults,
  });
  if (!result) return { ok: false, error: "Store record not found.", status: 404 };
  return { ok: true, patch, metafieldStatus: result.metafieldStatus };
}
