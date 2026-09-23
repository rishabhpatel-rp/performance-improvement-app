import { authenticate } from "../shopify.server";
import { redirect } from "react-router";
import prisma from "../db.server";
import {
  discoverPages,
  runHiddenAudit,
  getActiveThemeId,
} from "../lib/audit.server";
import { saveAuditReport } from "../lib/store-sync.server";
import { isAppEmbedEnabled, getAppEmbedDeepLink } from "../lib/theme-embed.server";

async function setAuditRunning(storeId, running) {
  await prisma.storeConfig.upsert({
    where: { storeId },
    create: {
      storeId,
      appEnabled: false,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      auditRunning: running,
    },
    update: {
      auditRunning: running,
      auditFailed: false,
      auditError: null,
      auditComplete: false,
      auditPageIndex: 0,
      auditTotalPages: 0,
    },
  });
}

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  // The audit scans the storefront, so it can only run once the
  // Performance Script Loader theme app embed is installed and enabled.
  const embedEnabled = await isAppEmbedEnabled(admin);
  if (embedEnabled !== true) {
    // Redirect directly to the theme editor so user can enable the embed
    const embedUrl = getAppEmbedDeepLink(session.shop);
    return redirect(embedUrl);
  }

  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
  });

  if (!store) {
    return new Response(
      JSON.stringify({ ok: false, error: "Store record not found" }),
      { status: 404, headers: { "Content-Type": "application/json" } },
    );
  }

  const config = await prisma.storeConfig.findUnique({
    where: { storeId: store.id },
  });

  // Already audited — nothing to do (OFF->ON re-audit is handled by the
  // caller resetting auditComplete before starting).
  if (config?.auditComplete && config?.auditRunning !== true) {
    return new Response(
      JSON.stringify({ ok: true, running: false, complete: true }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  await setAuditRunning(store.id, true);

  // Run the hidden headless-browser audit in the background so this action
  // returns immediately and the dashboard can poll api.audit.status.
  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    try {
      // Mirror app._index.jsx's startHiddenAudit: read the store owner's
      // saved storefront password (if any) and pass it + the active theme
      // id through so a password-protected store is audited via the
      // bypass URLs instead of hitting Shopify's password page.
      const password = config?.storefrontPassword || "";
      const themeId = password ? await getActiveThemeId(admin) : undefined;
      const customUrls = {
        plp: config?.customPlpUrl || undefined,
        pdp: config?.customPdpUrl || undefined,
      };

      const pages = await discoverPages(
        admin,
        session.shop,
        password || undefined,
        themeId,
        customUrls,
      );
      const report = await runHiddenAudit({ pages, password: password || undefined });
      await saveAuditReport(session.shop, report);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[audit] Hidden audit failed:", msg);
      await prisma.storeConfig.update({
        where: { storeId: store.id },
        data: {
          auditRunning: false,
          auditFailed: true,
          auditError: msg,
          auditComplete: false,
        },
      });
      try {
        await prisma.auditLog.create({
          data: {
            domain: session.shop,
            audit_type: "auto-audit",
            status: "failed",
            details: msg,
          },
        });
      } catch {
        // ignore audit-log write failures on error path
      }
    }
  })();

  return new Response(
    JSON.stringify({ ok: true, running: true }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
