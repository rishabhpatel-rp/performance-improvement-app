/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import { updateConfig } from "./metaobjects";
import { syncConfigToDatabase, logActivity } from "./store-sync.server";
import prisma from "../db.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";
import { rebuildPerformanceScript } from "./performance-script.server";

import {
  AUTH_CACHE_KEY,
  DEFAULT_CONFIG,
  STORE_CONFIG_SELECT,
  emptyAuditStatus,
  configFromDbRow,
} from "./dashboard-loader-core.ts";
export { AUTH_CACHE_KEY, DEFAULT_CONFIG, STORE_CONFIG_SELECT, emptyAuditStatus, configFromDbRow };

export async function safeUpdateConfig(admin: any, input: any) {
  try {
    return await updateConfig(admin, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No metaobject definition exists")) {
      console.warn(
        "[Dashboard] Metaobject definition not deployed. " +
          "Run shopify app config push. Returning defaults.",
      );
      return { ...DEFAULT_CONFIG, ...input };
    }
    throw err;
  }
}

export async function safeSyncConfig(shop: any, config: any) {
  try {
    await syncConfigToDatabase(shop, {
      appEnabled: config.appEnabled,
      script1Enabled: config.script1Enabled,
      script2Enabled: config.script2Enabled,
      script3Enabled: config.script3Enabled,
      debugMode: config.debugMode,
      auditComplete: config.auditComplete,
      scriptTitles: config.scriptTitles,
      auditDeferArray: config.auditDeferArray,
      auditHideSelectors: config.auditHideSelectors,
    });
  } catch (err) {
    console.error("[Dashboard] DB sync failed:", err instanceof Error ? err.message : err);
  }
}

export async function safeLogActivity(shop: any, eventType: any, description: any, metadata: any) {
  try {
    await logActivity(shop, eventType, description, metadata);
  } catch (err) {
    console.error("[Dashboard] Failed to log activity:", err instanceof Error ? err.message : err);
  }
}

export async function disableAppBecauseEmbedOff({ admin, session, store }: any) {
  try {
    if (store?.id) {
      await prisma.storeConfig.update({
        where: { storeId: store.id },
        data: { appEnabled: false },
      });
    }
    await withShopifyTimeout(safeUpdateConfig(admin, { appEnabled: false }), "autoDisableConfig");
    await rebuildPerformanceScript(session.shop);
    await safeLogActivity(
      session.shop,
      "config_changed",
      "App auto-disabled: theme app embed is off",
      { changedFields: ["appEnabled"], reason: "embed_disabled" },
    );
  } catch (err) {
    rethrowAuthRedirect(err);
    console.error(
      "[Dashboard] Failed to persist auto-disable:",
      err instanceof Error ? err.message : err,
    );
  }
}
