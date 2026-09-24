import prisma from "../db.server";
import { discoverPages, runHiddenAudit, describePages } from "./audit.server";
import { saveAuditReport } from "./store-sync.server";
import { listThemes, numericThemeId } from "./theme-embed.server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

/**
 * `preview_theme_id` for the audit, or undefined when it is not needed.
 * The live (MAIN) theme is audited without the param (no Shopify preview bar
 * on the live pages); any other selected theme is previewed by its numeric id.
 */
async function resolvePreviewThemeId(
  admin: AdminClient,
  selectedThemeId: string | null | undefined,
): Promise<string | undefined> {
  if (!selectedThemeId) return undefined;
  try {
    const themes = await listThemes(admin);
    const theme = themes.find((t: { id: string }) => t.id === selectedThemeId);
    if (!theme) {
      console.warn(
        `[audit] Selected theme ${selectedThemeId} not found; auditing the live theme.`,
      );
      return undefined;
    }
    return theme.role === "MAIN" ? undefined : numericThemeId(theme.id);
  } catch (err) {
    console.warn(
      "[audit] Could not resolve selected theme:",
      err instanceof Error ? err.message : err,
    );
    return undefined;
  }
}

/**
 * Starts the hidden headless-browser audit for a shop and returns as soon as
 * the run is registered in the DB (auditRunning=true). The audit itself runs
 * in the background; the dashboard polls /api/audit/status.
 *
 * Writes, in order: run reset -> discovered pages (`auditPages`,
 * `auditTotalPages`, before Chromium launches, so the UI knows the real page
 * count immediately) -> per-page progress (`auditPageIndex`,
 * `auditPageStartedAt`) -> completion / failure.
 */
export async function startAuditForStore(
  admin: AdminClient,
  shopDomain: string,
  { enableOnCreate = false }: { enableOnCreate?: boolean } = {},
): Promise<{ started: boolean }> {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) {
    console.warn(`[Audit] SKIPPED — no Store row for ${shopDomain}.`);
    return { started: false };
  }
  const storeId = store.id;

  await prisma.storeConfig.upsert({
    where: { storeId },
    create: {
      storeId,
      auditPhase: "discovering",
      appEnabled: enableOnCreate,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      auditRunning: true,
      auditFailed: false,
      auditError: null,
    },
    update: {
      auditRunning: true,
      auditFailed: false,
      auditError: null,
      auditComplete: false,
      auditPageIndex: 0,
      auditTotalPages: 0,
      auditPages: [],
      auditPageStartedAt: null,
      auditPhase: "discovering",
    },
  });
  console.log(`[Audit] STARTED for ${shopDomain} (auditRunning=true)`);

  // eslint-disable-next-line @typescript-eslint/no-floating-promises
  (async () => {
    try {
      // Storefront password (Step 1, password-protected stores), custom PLP/PDP
      // URLs and the theme the merchant chose for the extension.
      const config = await prisma.storeConfig.findUnique({
        where: { storeId },
      });
      const password = config?.storefrontPassword || "";
      const themeId = await resolvePreviewThemeId(
        admin,
        config?.selectedThemeId,
      );
      const customUrls = {
        plp: config?.customPlpUrl || undefined,
        pdp: config?.customPdpUrl || undefined,
      };

      const pages = await discoverPages(
        admin,
        shopDomain,
        password || undefined,
        themeId,
        customUrls,
      );
      const described = describePages(pages);
      // Log paths only — the real URLs may carry the storefront password.
      console.log(
        `[Audit] Pages discovered for ${shopDomain}: ${described
          .map((p) => `${p.label} ${p.path}`)
          .join(", ")}${themeId ? ` (preview_theme_id=${themeId})` : ""}`,
      );

      // Publish the real page list + count now, before Chromium launches.
      await prisma.storeConfig.update({
        where: { storeId },
        data: {
          auditPages: described,
          auditTotalPages: described.length,
          auditPageIndex: 0,
          auditPhase: "auditing",
        },
      });

      const report = await runHiddenAudit({
        pages,
        password: password || undefined,
        // Pages are audited in parallel: `done` counts finished pages.
        onProgress: async ({ done, total }) => {
          try {
            await prisma.storeConfig.update({
              where: { storeId },
              data: { auditPageIndex: done, auditTotalPages: total },
            });
          } catch (err) {
            console.warn(
              "[Audit] Failed to record progress:",
              err instanceof Error ? err.message : err,
            );
          }
        },
      });

      // Building the storefront script happens inside saveAuditReport; it
      // flips auditComplete only once the script is stored.
      await prisma.storeConfig.update({
        where: { storeId },
        data: { auditPhase: "building" },
      });
      await saveAuditReport(shopDomain, report);
      await prisma.storeConfig.update({
        where: { storeId },
        data: {
          auditRunning: false,
          auditComplete: true,
          auditFailed: false,
          auditError: null,
          auditPageIndex: described.length,
          auditTotalPages: described.length,
          auditPhase: null,
        },
      });
      console.log(
        `[Audit] COMPLETED for ${shopDomain}: defer=${JSON.stringify(report.deferArray)} hide=${JSON.stringify(report.hideSelectors)}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[Audit] FAILED for ${shopDomain}:`, msg);
      await prisma.storeConfig
        .update({
          where: { storeId },
          data: {
            auditRunning: false,
            auditFailed: true,
            auditError: msg,
            auditComplete: false,
            auditPhase: null,
          },
        })
        .catch(() => {});
      await prisma.auditLog
        .create({
          data: {
            domain: shopDomain,
            audit_type: "auto-audit",
            status: "failed",
            details: msg,
          },
        })
        .catch(() => {
          // ignore audit-log write failures on the error path
        });
    }
  })();

  return { started: true };
}
