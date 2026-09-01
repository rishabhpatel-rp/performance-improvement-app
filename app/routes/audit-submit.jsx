// Public, unauthenticated endpoint. The storefront audit script (script_1)
// POSTs its two result arrays here once it finishes auditing the last
// detected page (Home / PLP / PDP). No app proxy / session token is
// available on the storefront, so the shop is derived from the request's
// Origin/Referer header instead.
//
// Security note (accepted risk, see IMPLEMENTATION_PLAN_4.md Task 1.3):
// this is a public write endpoint for low-stakes config data (a defer list
// + CSS selectors, no PII). It's mitigated by requiring the shop to already
// have an offline access token on file (`unauthenticated.admin` throws /
// we 404 otherwise) — a shop that hasn't installed the app can't write.
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { setAuditResults, getConfig } from "../lib/metaobjects";
import { syncConfigToDatabase, logActivity } from "../lib/store-sync.server";

function shopFromHost(hostname) {
  if (!hostname) return null;
  const host = hostname.replace(/^www\./i, "");
  if (host.endsWith(".myshopify.com")) return host;
  // Custom domains aren't necessarily <handle>.myshopify.com — the actual
  // shop lookup below still validates via the Session table.
  return host;
}

function deriveShop(request) {
  const origin =
    request.headers.get("Origin") || request.headers.get("Referer");
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return shopFromHost(url.hostname);
  } catch {
    return null;
  }
}

function sanitizeStringArray(value, max = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const originShop = deriveShop(request);
  if (!originShop) {
    return new Response(
      JSON.stringify({ ok: false, error: "shop not resolvable" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  // The origin's hostname may be a *.myshopify.com domain or a custom
  // domain mapped to one. Look up an existing offline session either by
  // exact shop match or, for custom domains, fall back to failing closed
  // (404) rather than guessing — this endpoint should only ever be hit
  // from a store's own theme.
  const session = await db.session.findFirst({
    where: { shop: originShop, isOnline: false },
  });
  if (!session) {
    // No offline token on file for this shop => app isn't installed (or
    // this isn't a *.myshopify.com origin we recognize). Fail closed.
    return new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const deferArray = sanitizeStringArray(body?.deferArray);
  const hideSelectors = sanitizeStringArray(body?.hideSelectors);

  try {
    const { admin } = await unauthenticated.admin(originShop);
    await setAuditResults(admin, { deferArray, hideSelectors });

    // Mirror the freshly-written metaobject config into Postgres and drop
    // an activity record so the admin panel timeline picks it up. This is
    // best-effort — a DB hiccup here must never fail the storefront's
    // audit submission, which is why it's wrapped in its own try/catch.
    try {
      const updatedConfig = await getConfig(admin);
      await syncConfigToDatabase(originShop, {
        appEnabled: updatedConfig.appEnabled,
        script1Enabled: updatedConfig.script1Enabled,
        script2Enabled: updatedConfig.script2Enabled,
        script3Enabled: updatedConfig.script3Enabled,
        debugMode: updatedConfig.debugMode,
        auditComplete: updatedConfig.auditComplete,
        scriptTitles: updatedConfig.scriptTitles,
        auditDeferArray: updatedConfig.auditDeferArray,
        auditHideSelectors: updatedConfig.auditHideSelectors,
      });
      await logActivity(
        originShop,
        "audit_completed",
        `Audit completed — ${deferArray.length} defer entries, ${hideSelectors.length} hide selectors`,
        { deferCount: deferArray.length, hideCount: hideSelectors.length },
      );
    } catch (err) {
      console.error(
        `[audit-submit] Failed to sync config to DB for ${originShop}:`,
        err instanceof Error ? err.message : err,
      );
    }
  } catch (err) {
    console.error(
      `[audit-submit] Failed to write audit results for ${originShop}:`,
      err,
    );
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      // Storefront JS on the shop's own domain calls this cross-origin.
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    },
  });
};

// Preflight support for the storefront's cross-origin POST.
export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return new Response("Not Found", { status: 404 });
};
