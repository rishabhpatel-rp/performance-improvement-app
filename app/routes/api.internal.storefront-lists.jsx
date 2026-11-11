import { decideInternalStorefrontRequest, readInternalSecret } from "../lib/internal-storefront-route.js";
import {
  applyStorefrontLists,
  toggleStorefrontFamily,
} from "../lib/store-sync-audit.server";
import { buildArrayPatchForTokenAction } from "../lib/audit-script-actions";
import { familyFromField, scopeListColumn } from "../lib/storefront-lists";
import { readStringArray } from "../lib/performance-script.server";
import prisma from "../db.server";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function writeDecision(decision) {
  const write = decision.write;
  if (write.kind === "toggle") {
    const family = familyFromField(write.field);
    if (!family) return json({ ok: false, error: "Invalid field." }, 400);
    const result = await toggleStorefrontFamily(write.shopDomain, family, write.enabled);
    if (!result) return json({ ok: false, error: "Store record not found." }, 404);
    return json({
      ok: true,
      metafieldStatus: result.metafieldStatus,
      field: write.field,
      enabled: result.enabled,
    });
  }

  if (write.kind === "script-token-action") {
    const store = await prisma.store.findUnique({
      where: { shopDomain: write.shopDomain },
      include: { configs: { take: 1 } },
    });
    const sc = store?.configs?.[0];
    if (!sc) return json({ ok: false, error: "Store config not found." }, 404);
    if (sc.auditDeferArrayEnabled === false && write.actionName === "defer") {
      return json({ ok: false, error: "Defer lists are disabled in Step 2." }, 400);
    }
    const lists = buildArrayPatchForTokenAction(
      {
        auditDeferArray: readStringArray(sc[scopeListColumn("defer", write.scope)]),
        firstUserDelayScripts: readStringArray(sc[scopeListColumn("first", write.scope)]),
        staticDeferDefaults: readStringArray(sc[scopeListColumn("every", write.scope)]),
      },
      write.token,
      write.actionName,
    );
    if (!lists) return json({ ok: true, noop: true });
    const result = await applyStorefrontLists(write.shopDomain, write.scope, {
      defer: lists.auditDeferArray,
      first: lists.firstUserDelayScripts,
      every: lists.staticDeferDefaults,
    });
    if (!result) return json({ ok: false, error: "Store record not found." }, 404);
    return json({ ok: true, metafieldStatus: result.metafieldStatus });
  }

  const result = await applyStorefrontLists(write.shopDomain, write.scope, write.patch);
  if (!result) return json({ ok: false, error: "Store record not found." }, 404);
  return json({ ok: true, metafieldStatus: result.metafieldStatus });
}

export const action = async ({ request }) => {
  const decision = await decideInternalStorefrontRequest(
    request,
    readInternalSecret(),
  );
  if (!decision.write) return json(decision.body, decision.status);
  return writeDecision(decision);
};
