import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import { ensureConfig, ensureAppEndpoint } from "./metaobjects";
import {
  fetchShopDetailsFromShopify,
  upsertStore,
  readStringArray,
  readAuditPages,
} from "./store-sync.server";
import { reconcileOrphanedStoreAuditState } from "./audit-queue-reconcile.server";
import { maybeSweepStaleAuditStateForShop } from "./audit-watchdog.server";
import { reconcileScriptMetafield } from "./script-metafield.server";
import { healStoreIfReinstalled } from "./store-heal.server";
import { refreshPasswordProtection } from "./password-protection.server";
import {
  resolveAppEmbedEnabled,
  getAppEmbedDeepLink,
} from "./theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";
import { templateConfigFromRow } from "./template-script-config";
import {
  AUTH_CACHE_KEY,
  DEFAULT_CONFIG,
  STORE_CONFIG_SELECT,
  safeSyncConfig,
  safeLogActivity,
  disableAppBecauseEmbedOff,
  emptyAuditStatus,
  configFromDbRow,
} from "./dashboard-helpers.server.js";

export const loader = async ({ request }) => {
  const loaderStarted = Date.now();

  // Use cached auth from parent layout loader (one auth on paint path)
  const cached = request[AUTH_CACHE_KEY];
  if (!cached) {
    // Fallback: if no cache, we need to authenticate (first open, or direct navigation)
    const { admin, session } = await authenticate.admin(request);
    request[AUTH_CACHE_KEY] = { admin, session };
  }
  const { admin, session } = request[AUTH_CACHE_KEY];

  void healStoreIfReinstalled(session.shop).catch(() => undefined);

  // eslint-disable-next-line no-undef
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const endpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";

  // Check if we can use fast path: Store exists AND isActive=true
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      isActive: true,
      lastSyncedAt: true,
      configs: { select: STORE_CONFIG_SELECT },
    },
  });

  const hasActiveStore = store?.isActive === true;
  if (hasActiveStore) {
    // Backfill / heal the inline-script metafield without delaying the
    // dashboard: rate-limited per shop and it never throws.
    void reconcileScriptMetafield(session.shop);
    void maybeSweepStaleAuditStateForShop(session.shop);
    void reconcileOrphanedStoreAuditState(session.shop).catch(() => undefined);
  }
  const sc = store?.configs?.[0];
  const selectedThemeId = sc?.selectedThemeId ?? null;

  // Always re-check the theme app embed (fast path included), in parallel with
  // the Shopify calls below. It targets the theme the merchant picked (live
  // theme when none). true = enabled, false = definitely off, null = unknown
  // (error / timeout) — treated as OFF by the toggle.
  const embedPromise = withShopifyTimeout(
    resolveAppEmbedEnabled(admin, session.shop, selectedThemeId),
    "isAppEmbedEnabled",
  ).catch((err) => {
    rethrowAuthRedirect(err);
    console.error(
      "[Dashboard] Failed to read embed status:",
      err instanceof Error ? err.message : err,
    );
    return null;
  });
  // The auth-redirect Response is re-thrown when embedPromise is awaited below;
  // this only prevents an unhandled rejection if the loader exits before that.
  embedPromise.catch(() => {});

  // Fast path: active store exists -> return from DB immediately
  // Four conditions force a Shopify refresh (there is no "Gate D"; the four
  // gates are labelled A, B, C and the unlabelled 10-minute staleness check).
  const currentEndpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";
  const endpointMismatch =
    Boolean(currentEndpoint) &&
    Boolean(sc?.cachedAppEndpoint) &&
    sc.cachedAppEndpoint !== currentEndpoint;
  const needsShopifyRefresh =
    !hasActiveStore || // Gate A: no Store row, or Gate B: isActive=false
    (store?.lastSyncedAt &&
      Date.now() - store.lastSyncedAt.getTime() > 10 * 60 * 1000) || // Stale > 10 min
    request.url.includes("?refresh=1"); // Explicit refresh — Gate C is async (below)

  if (endpointMismatch && hasActiveStore) {
    void (async () => {
      try {
        const { config } = await withShopifyTimeout(
          ensureConfig(admin),
          "ensureConfig",
        );
        const shopifyCfg =
          endpoint && config.appEndpoint !== endpoint
            ? await withShopifyTimeout(
                ensureAppEndpoint(admin, endpoint, config),
                "ensureAppEndpoint",
              )
            : config;
        const storeId =
          store?.id ??
          (
            await prisma.store.findUnique({
              where: { shopDomain: session.shop },
              select: { id: true },
            })
          )?.id;
        if (storeId) {
          await prisma.storeConfig.update({
            where: { storeId },
            data: {
              cachedAppEndpoint: shopifyCfg?.appEndpoint || endpoint || null,
            },
          });
        }
        if (shopifyCfg) await safeSyncConfig(session.shop, shopifyCfg);
      } catch (err) {
        rethrowAuthRedirect(err);
        console.warn(
          "[Dashboard] background Gate C endpoint sync failed:",
          err instanceof Error ? err.message : err,
        );
      }
    })();
  }

let shopResult = { shopData: null, isNewStore: false };
  let shopifyConfig = null;
  let embedCheck = null;
  // true / false once confirmed, null = not determined yet (see below).
  let passwordProtected = null;
  let isNewStore = false;

  if (needsShopifyRefresh) {
    // Slow path: run Shopify calls in parallel (only when needed)
    const [shopRes, shopifyCfg, embedChk] = await Promise.all([
      (async () => {
        try {
          const shopData = await withShopifyTimeout(
            fetchShopDetailsFromShopify(admin),
            "ShopDetails",
          );
          shopData.currentScope = session.scope || undefined;
          const existingStore = await prisma.store.findUnique({
            where: { shopDomain: shopData.shopDomain },
            select: { id: true },
          });
          await upsertStore(shopData);
          return { shopData, isNewStore: !existingStore };
        } catch (err) {
          rethrowAuthRedirect(err);
          console.error(
            "[Dashboard] Failed to sync store details:",
            err instanceof Error ? err.message : err,
          );
          return { shopData: null, isNewStore: false };
        }
      })(),
      (async () => {
        try {
          const { config } = await withShopifyTimeout(
            ensureConfig(admin),
            "ensureConfig",
          );
          // Gate C: only write appEndpoint if URL differs
          if (!endpoint || config.appEndpoint === endpoint) {
            return config;
          }
          return await withShopifyTimeout(
            ensureAppEndpoint(admin, endpoint, config),
            "ensureAppEndpoint",
          );
        } catch (err) {
          rethrowAuthRedirect(err);
          console.error(
            "[Dashboard] Failed to load Shopify config:",
            err instanceof Error ? err.message : err,
          );
          return null;
        }
      })(),
      embedPromise,
    ]);

    shopResult = shopRes;
    shopifyConfig = shopifyCfg;
    embedCheck = embedChk;
    isNewStore = shopResult.isNewStore;

    // Deliberately NOT guarded by `store?.id` alone: `store` was read BEFORE
    // upsertStore() ran, so on a genuine first visit it is null and the cache
    // was never written, leaving Gate C permanently unsatisfied.
    // Cache the app endpoint in StoreConfig for the fast path (Gate C).
    if (isNewStore || store?.id) {
      try {
        const storeId =
          store?.id ??
          (
            await prisma.store.findUnique({
              where: { shopDomain: session.shop },
              select: { id: true },
            })
          )?.id;
        if (!storeId) {
          throw new Error("Store row missing after upsert");
        }
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
            cachedAppEndpoint: shopifyConfig?.appEndpoint || endpoint || null,
          },
          update: {
            cachedAppEndpoint: shopifyConfig?.appEndpoint || endpoint || null,
          },
        });
      } catch (err) {
        console.error("[Dashboard] Failed to cache app endpoint:", err instanceof Error ? err.message : err);
      }
    }

    // Sync config from Shopify to DB (non-blocking on fast path)
    if (shopifyConfig) {
      await safeSyncConfig(session.shop, shopifyConfig);
    }

    // Log "installed" activity only when creating the Store row (first visit)
    if (isNewStore && shopResult.shopData) {
      await safeLogActivity(
        session.shop,
        "installed",
        `App installed — ${shopResult.shopData.shopName}`,
        { source: "first_visit", shopDomain: session.shop },
      );
    }
  } else {
    // Fast path: use cached values from DB, but the embed is always re-checked.
    embedCheck = await embedPromise;
  }

  // Password protection is confirmed in the BACKGROUND (never awaited here, so
  // the dashboard is not slowed down): a redirect probe of the store's live URL
  // in Chromium plus Shopify's own setting. Until a definite answer is stored
  // this stays null and the Step 1 password box stays hidden; the client polls
  // /api/password-status and shows the box when protection is confirmed.
  passwordProtected = sc?.isPasswordProtected ?? null;
  if ((passwordProtected === null || needsShopifyRefresh) && !sc?.auditRunning) {
    void refreshPasswordProtection(admin, session.shop);
  }

  const dbConfig = configFromDbRow(sc);

  // On fast path, Shopify config is null -> use DB config
  // On slow path with successful Shopify call, Shopify config wins
  const mergedConfig = shopifyConfig
    ? shopifyConfig
    : dbConfig
      ? { ...DEFAULT_CONFIG, ...dbConfig }
      : DEFAULT_CONFIG;

  // Fail closed: only a confirmed `true` counts as enabled. `false` (embed off)
  // and `null` (check errored / timed out) both switch the toggle OFF.
  const embedEnabled = embedCheck === true;
  const embedStatus =
    embedCheck === true ? "enabled" : embedCheck === false ? "disabled" : "unknown";
  const embedActivateUrl = getAppEmbedDeepLink(
    session.shop,
    undefined,
    undefined,
    selectedThemeId,
  );

  // The embed is definitely off but the app is still recorded as enabled.
  // Not done for `null` (unknown) — a transient failure must not rewrite state.
  let autoDisabled = false;
  if (embedCheck === false && (sc?.appEnabled || mergedConfig.appEnabled)) {
    autoDisabled = true;
    mergedConfig.appEnabled = false;
    await disableAppBecauseEmbedOff({ admin, session, store });
  }

  let auditStatus = emptyAuditStatus();
  let hasStorefrontPassword = false;
  let customPlpUrl = "";
  let customPdpUrl = "";
  // Extra pages from the "+" button. Empty until the select above is read.
  let customPageUrls = [];
  if (sc) {
    hasStorefrontPassword = Boolean(sc.storefrontPassword);
    customPlpUrl = sc.customPlpUrl || "";
    customPdpUrl = sc.customPdpUrl || "";
    customPageUrls = readStringArray(sc.customPageUrls);
    const pageIndex = sc.auditPageIndex ?? 0;
    const totalPages = sc.auditTotalPages ?? 0;
    auditStatus = {
      running: sc.auditRunning,
      complete: sc.auditComplete,
      failed: sc.auditFailed,
      error: sc.auditError,
      pageIndex,
      totalPages,
      progress: totalPages > 0 ? Math.round((pageIndex / totalPages) * 100) : 0,
      pages: readAuditPages(sc.auditPages),
      pageStartedAt: sc.auditPageStartedAt
        ? sc.auditPageStartedAt.toISOString()
        : null,
      phase: sc.auditPhase ?? null,
      serverNow: Date.now(),
    };
  }

  let auditDeferArray = readStringArray(mergedConfig.auditDeferArray);
  let auditHideSelectors = readStringArray(mergedConfig.auditHideSelectors);
  let staticDeferDefaults = ["wpm","gtm"];
  let dbToggle = null;
  let dbPreserved = null;
  if (sc) {
    const dbDefer = readStringArray(sc.auditDeferArray);
    const dbHide = readStringArray(sc.auditHideSelectors);
    const dbStatic = readStringArray(sc.staticDeferDefaults);
    // The DB is authoritative for these two arrays once an audit has actually
    // run. Previously this fell back to the metaobject whenever the DB array
    // was empty, which meant an audit that legitimately produced `[]` (e.g.
    // everything fold-protected, or a cleared run) was masked by a stale
    // metaobject value — the dashboard showed data the storefront script did
    // not have. `auditHasRun` keeps merchant-typed arrays working: a value
    // entered via `intent: "save-audit-defer"` only exists in the metaobject,
    // and that path is reachable before any audit has run.
    const auditHasRun = Boolean(sc.lastAuditAt);
    if (auditHasRun || dbDefer.length) auditDeferArray = dbDefer;
    if (auditHasRun || dbHide.length) auditHideSelectors = dbHide;
    staticDeferDefaults = dbStatic.length > 0 ? dbStatic : staticDeferDefaults;
    dbToggle = {
      auditDeferArrayEnabled: sc.auditDeferArrayEnabled ?? true,
      auditHideSelectorsEnabled: sc.auditHideSelectorsEnabled ?? true,
      staticDeferDefaultsEnabled: sc.staticDeferDefaultsEnabled ?? true,
      firstUserDelayScriptsEnabled: sc.firstUserDelayScriptsEnabled ?? true,  // NEW
    };
    dbPreserved = {
      auditDeferArrayPreserved: readStringArray(sc.auditDeferArrayPreserved),
      auditHideSelectorsPreserved: readStringArray(sc.auditHideSelectorsPreserved),
      staticDeferDefaultsPreserved: readStringArray(
        sc.staticDeferDefaultsPreserved,
      ),
      firstUserDelayScriptsPreserved: readStringArray(sc.firstUserDelayScriptsPreserved),
    };
  }

  const finalConfig = {
    ...mergedConfig,
    auditDeferArray,
    auditHideSelectors,
    staticDeferDefaults,
    auditDeferArrayEnabled: dbToggle?.auditDeferArrayEnabled ?? true,
    auditHideSelectorsEnabled: dbToggle?.auditHideSelectorsEnabled ?? true,
    staticDeferDefaultsEnabled: dbToggle?.staticDeferDefaultsEnabled ?? true,
    auditDeferArrayPreserved: dbPreserved?.auditDeferArrayPreserved ?? [],
    auditHideSelectorsPreserved: dbPreserved?.auditHideSelectorsPreserved ?? [],
    staticDeferDefaultsPreserved:
      dbPreserved?.staticDeferDefaultsPreserved ?? [],
    hasStorefrontPassword,
    customPlpUrl,
    customPdpUrl,
    customPageUrls,

    // NEW
      // readStringArray always returns an array and [] is truthy, so the old
      // `|| ["wpm","gtm"]` could never fall back. Check the length
      // explicitly so a genuinely-absent column gets the schema default.
      firstUserDelayScripts: (() => {
        const v = readStringArray(sc?.firstUserDelayScripts);
        return v.length ? v : ["wpm", "gtm"];
      })(),
    firstUserDelayScriptsEnabled: sc?.firstUserDelayScriptsEnabled ?? true,
      firstUserDelayScriptsPreserved: (() => { const v = readStringArray(sc?.firstUserDelayScriptsPreserved); return v.length ? v : []; })(), // readStringArray always returns an
      // array and [] is truthy, so `|| []` could never fall back.
      // Check the length explicitly to get the schema default.
    firstUserDelayMs: sc?.firstUserDelayMs ?? 12000,
    everyTimeDelayMs: sc?.everyTimeDelayMs ?? 6000,
    ...templateConfigFromRow(sc),
    // DB-authoritative audit flags (metaobject merge must not clear these).
    auditComplete: sc?.auditComplete ?? false,
    auditRunning: sc?.auditRunning ?? false,
    auditFailed: sc?.auditFailed ?? false,
  };

  console.log(
    `[Dashboard] loader ${Date.now() - loaderStarted}ms shopifyConfig=${Boolean(
      shopifyConfig,
    )} embed=${embedStatus} autoDisabled=${autoDisabled} fastPath=${!needsShopifyRefresh} pwProtected=${passwordProtected} endpointMatch=${sc?.cachedAppEndpoint === endpoint}`,
  );

  return {
    config: finalConfig,
    auditReportSummary: null,
    auditStatus,
    embedEnabled,
    embedStatus,
    embedActivateUrl,
    selectedThemeId,
    passwordProtected,
    headDelivery: {
      status: sc?.themeHeadInjectStatus ?? "not_attempted",
      error: sc?.themeHeadInjectError ?? null,
      attemptedAt: sc?.themeHeadInjectAttemptedAt?.toISOString?.() ?? null,
    },
  };
};
