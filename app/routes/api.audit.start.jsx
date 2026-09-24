import { authenticate } from "../shopify.server";
import { redirect } from "react-router";
import prisma from "../db.server";
import { startAuditForStore } from "../lib/audit-runner.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
  getSelectedThemeId,
} from "../lib/theme-embed.server";

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);

  // The audit scans the storefront, so it can only run once the
  // Performance Script Loader theme app embed is installed and enabled in the
  // theme the merchant selected (live theme when none is selected).
  const selectedThemeId = await getSelectedThemeId(session.shop).catch(
    () => null,
  );
  const embedEnabled = await isAppEmbedEnabled(
    admin,
    undefined,
    selectedThemeId,
  );
  if (embedEnabled !== true) {
    // Redirect directly to the theme editor so user can enable the embed
    const embedUrl = getAppEmbedDeepLink(
      session.shop,
      undefined,
      undefined,
      selectedThemeId,
    );
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

  // Same runner as the toggle-driven audit: records the discovered pages,
  // per-page progress and completion, then runs in the background.
  const { started } = await startAuditForStore(admin, session.shop);

  return new Response(JSON.stringify({ ok: started, running: started }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
