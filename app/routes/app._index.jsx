import { stepHeadingLabel } from "../lib/a11y.ts";
import { useState, useEffect, useRef, useCallback, useReducer } from "react";
import { useLoaderData, useFetchers, useRouteError, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

import { ensureConfig, ensureAppEndpoint } from "../lib/metaobjects";
import { getEnv } from "../lib/env.server.ts";
import { fetchShopDetailsFromShopify, upsertStore } from "../lib/store-sync.server";
import { assertMerchantCanMutate } from "../lib/admin-managed.server.ts";
import { isDashboardIntent, runDashboardIntent } from "../lib/dashboard-actions.server.ts";
import {
  AUTH_CACHE_KEY,
  DEFAULT_CONFIG,
  STORE_CONFIG_SELECT,
  safeSyncConfig,
  safeLogActivity,
  disableAppBecauseEmbedOff,
  configFromDbRow,
} from "../lib/dashboard-helpers.server.ts";
import { getShopQueueSnapshot } from "../lib/audit-queue-position.server";
import { refreshPasswordProtection } from "../lib/password-protection.server";
import { isAppEmbedEnabled, getAppEmbedDeepLink } from "../lib/theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "../lib/shopify-timeout.server";
import {
  resolveStoreIdForCache,
  cachedAppEndpointValue,
  cacheAppEndpoint,
} from "../lib/dashboard-endpoint-cache.server.ts";
import { fireAndForget, logger } from "../lib/logger.ts";
import {
  needsShopifyRefresh as computeNeedsShopifyRefresh,
  buildAuditStatus as assembleAuditStatus,
  buildFinalConfig as assembleFinalConfig,
} from "../lib/dashboard-loader.server.ts";
import { dashboardReducer, deriveMaxStep } from "../lib/audit-state-machine.ts";
import {
  DASHBOARD_ACTIVE_POLL_MS,
  DASHBOARD_QUEUED_POLL_MS,
  FOCUS_REVALIDATE_MIN_MS,
} from "../lib/constants.ts";
import prisma from "../db.server";
import { usePasswordStatus } from "../lib/use-password-status";
import WizardProgress from "../components/WizardProgress";
import Step1Activate from "../components/Step1Activate";
import Step2Configure from "../components/Step2Configure";
import { templateConfigFromRow } from "../lib/template-script-config";
import { buildStep2Version } from "../lib/step2-config.server";
import WizardNavigation from "../components/WizardNavigation";
import FooterBranding from "../components/FooterBranding";
import RouteErrorBoundary from "../components/RouteErrorBoundary.jsx";

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

  const appUrl = getEnv().SHOPIFY_APP_URL;
  const endpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";

  // Check if we can use fast path: Store exists AND isActive=true
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    select: {
      id: true,
      isActive: true,
      lastSyncedAt: true,
      configs: { select: STORE_CONFIG_SELECT },
      performanceScript: { select: { scriptHash: true, metafieldSyncedAt: true } },
    },
  });

  const sc = store?.configs?.[0];
  const selectedThemeId = sc?.selectedThemeId ?? null;

  // Always re-check the theme app embed (fast path included), in parallel with
  // the Shopify calls below. It targets the theme the merchant picked (live
  // theme when none). true = enabled, false = definitely off, null = unknown
  // (error / timeout) — treated as OFF by the toggle.
  const embedPromise = withShopifyTimeout(
    isAppEmbedEnabled(admin, undefined, selectedThemeId),
    "isAppEmbedEnabled",
  ).catch((err) => {
    rethrowAuthRedirect(err);
    logger.error(
      "[Dashboard] Failed to read embed status:",
      err instanceof Error ? err.message : err,
    );
    return null;
  });
  // The auth-redirect Response is re-thrown when embedPromise is awaited below;
  // this only prevents an unhandled rejection if the loader exits before that.
  fireAndForget(embedPromise, "embed status check");

  // Fast path: active store exists -> return from DB immediately
  // Four conditions force a Shopify refresh (there is no "Gate D"; the four
  // gates are labelled A, B, C and the unlabelled 10-minute staleness check).
  const currentEndpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";
  const needsShopifyRefresh = computeNeedsShopifyRefresh(
    store,
    request.url,
    currentEndpoint,
    sc?.cachedAppEndpoint,
  );

  let shopResult = { shopData: null, isNewStore: false };
  let persistedStoreId = store?.id ?? null;
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
          const upsertedStore = await upsertStore(shopData);
          persistedStoreId = resolveStoreIdForCache(store, upsertedStore);
          return { shopData, isNewStore: !store };
        } catch (err) {
          rethrowAuthRedirect(err);
          logger.error(
            "[Dashboard] Failed to sync store details:",
            err instanceof Error ? err.message : err,
          );
          return { shopData: null, isNewStore: false };
        }
      })(),
      (async () => {
        try {
          const { config } = await withShopifyTimeout(ensureConfig(admin), "ensureConfig");
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
          logger.error(
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

    // `store` predates upsertStore(), so a first visit needs the upserted id.
    await cacheAppEndpoint(
      prisma,
      persistedStoreId,
      cachedAppEndpointValue(shopifyConfig, endpoint),
      logger,
    );

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
  if (passwordProtected === null || needsShopifyRefresh) {
    fireAndForget(refreshPasswordProtection(admin, session.shop), "password protection refresh");
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
  const embedActivateUrl = getAppEmbedDeepLink(session.shop, undefined, undefined, selectedThemeId);

  // The embed is definitely off but the app is still recorded as enabled.
  // Not done for `null` (unknown) — a transient failure must not rewrite state.
  let autoDisabled = false;
  if (embedCheck === false && (sc?.appEnabled || mergedConfig.appEnabled)) {
    autoDisabled = true;
    mergedConfig.appEnabled = false;
    await disableAppBecauseEmbedOff({
      admin,
      session,
      store: persistedStoreId ? { ...(store ?? {}), id: persistedStoreId } : store,
    });
  }

  let auditStatus = assembleAuditStatus(
    sc,
    sc && persistedStoreId != null
      ? await getShopQueueSnapshot(persistedStoreId, sc.activeAuditJobId, sc.auditPhase)
      : null,
  );

  const finalConfig = assembleFinalConfig(mergedConfig, sc, templateConfigFromRow(sc));

  logger.info(
    `[Dashboard] loader ${Date.now() - loaderStarted}ms shopifyConfig=${Boolean(
      shopifyConfig,
    )} embed=${embedStatus} autoDisabled=${autoDisabled} fastPath=${!needsShopifyRefresh} pwProtected=${passwordProtected} endpointMatch=${sc?.cachedAppEndpoint === endpoint}`,
  );

  return {
    config: finalConfig,
    shopDomain: session.shop,
    adminManaged: sc?.adminManaged === true,
    auditStatus,
    embedEnabled,
    embedStatus,
    embedActivateUrl,
    selectedThemeId,
    passwordProtected,
    configVersion: buildStep2Version(store, sc, store?.performanceScript ?? null),
  };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();

  // Admin-managed shops are read-only for the merchant: refuse on the server,
  // not just in the UI, so a stale tab or a hand-made request cannot write.
  if (isDashboardIntent(formData.get("intent"))) {
    const blocked = await assertMerchantCanMutate(session.shop);
    if (blocked) return blocked;
  }
  return runDashboardIntent({ admin, session, formData });
};

export default function Dashboard() {
  const {
    config,
    configVersion,
    auditStatus: initialAuditStatus,
    embedEnabled = false,
    embedStatus = "unknown",
    embedActivateUrl = "",
    selectedThemeId = null,
    passwordProtected: loaderPasswordProtected = null,
    adminManaged = false,
    shopDomain = "",
  } = useLoaderData();
  const revalidator = useRevalidator();
  const [machine, dispatch] = useReducer(dashboardReducer, {
    audit: initialAuditStatus?.failed
      ? "failed"
      : initialAuditStatus?.complete
        ? "complete"
        : initialAuditStatus?.running
          ? "running"
          : "idle",
    currentStep: 1,
  });
  const currentStep = machine.currentStep;
  const expectingAudit = ["queued", "discovering", "running"].includes(machine.audit);
  const [auditStatus, setAuditStatus] = useState(initialAuditStatus);
  const completingRef = useRef(false);
  const auditStatusEtagRef = useRef(null);
  const lastFocusRevalidateRef = useRef(0);
  const auditPollingRef = useRef(false);
  const stepHeadingRef = useRef(null);

  // Password protection: null until the background check has a definite answer
  // (the Step 1 password box stays hidden until then); polls for it.
  const passwordProtected = usePasswordStatus(loaderPasswordProtected);

  const handleAuditRestarted = useCallback(() => {
    completingRef.current = false;
    dispatch({ type: "AUDIT_STARTED" });
    setAuditStatus((s) => ({
      ...s,
      running: true,
      failed: false,
      complete: false,
      error: null,
      pageIndex: 0,
      totalPages: 0,
      progress: 0,
      pages: [],
      pageStartedAt: null,
      phase: "discovering",
    }));
  }, []);

  // Merge the live "toggle-app" fetcher result in so the app gate unlocks
  // immediately when the Step 1 toggle is turned on (the loader data alone
  // doesn't refresh after a useFetcher submit).
  // Matched ONLY by intent, never by response shape: `useFetchers()` also
  // returns fetchers owned by the Step components, so keying on a response
  // field would let a `start-audit` response be mistaken for a toggle result
  // and drive `appEnabled`.
  const toggleFetcher = useFetchers().find((f) => f.formData?.get("intent") === "toggle-app");
  const auditFetcher = useFetchers().find((f) => f.formData?.get("intent") === "start-audit");
  const extensionBlocked = toggleFetcher?.data?.error === "extension_required";
  // Turning ON waits for the action. Optimistic formData would treat a
  // missing embed as enabled and unlock Step 2 from a leftover auditComplete.
  // Turning OFF is optimistic so the spinner hides immediately.
  const rawAppEnabled =
    toggleFetcher?.data?.config?.appEnabled ??
    (toggleFetcher?.formData?.get("appEnabled") === "false" ? false : config.appEnabled);
  const appEnabled = !extensionBlocked && embedEnabled ? rawAppEnabled : false;

  // Fresh config that reflects the in-flight Step 1 toggle so Step 2 shows
  // scripts ON as soon as the app is enabled, before any reload.
  const liveConfig = toggleFetcher?.data?.config
    ? { ...config, ...toggleFetcher.data.config, appEnabled }
    : { ...config, appEnabled };

  // The app must be enabled in Step 1 AND the hidden audit must have
  // completed before Step 2 (Scripts + Titles) unlocks. Until then the wizard
  // stays locked on Step 1. Step 2 auto-opens when the poll reports complete.
  const maxStep = deriveMaxStep(machine.audit, appEnabled, extensionBlocked);

  useEffect(() => {
    stepHeadingRef.current?.focus();
  }, [currentStep, stepHeadingRef]);

  // Poll the hidden backend audit only while the main toggle is ON.
  // Toggle OFF must not start or keep showing an audit in progress.
  const auditInProgress = appEnabled && (expectingAudit || auditStatus?.running === true);

  // The audit is started explicitly from Step 1, never as a side effect of the
  // toggle. A successful `start-audit` response is what puts the dashboard into
  // the polling state. Keyed on the action's confirmed response, never on
  // in-flight formData: an optimistic start would skip the extension check.
  const enablingAudit =
    !extensionBlocked &&
    (auditFetcher?.data?.auditStarted === true ||
      // The toggle action auto-starts a re-run when it flips OFF -> ON, and
      // reports it here. Keyed on the action's confirmed response for the same
      // reason as start-audit: an optimistic start would skip the embed and
      // password checks the action already ran.
      toggleFetcher?.data?.auditStarted === true);

  // Re-check on focus in both directions: the merchant may enable or remove
  // the embed in another tab while this dashboard stays open.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (auditPollingRef.current) return;
      const now = Date.now();
      if (now - lastFocusRevalidateRef.current < FOCUS_REVALIDATE_MIN_MS) return;
      lastFocusRevalidateRef.current = now;
      void revalidator.revalidate();
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revalidator]);

  useEffect(() => {
    if (appEnabled && initialAuditStatus?.running) dispatch({ type: "AUDIT_STARTED" });
  }, [appEnabled, initialAuditStatus?.running]);

  // When the Step-1 toggle is flipped ON, the action's background audit has
  // started in the DB but the loader's auditStatus never heard about it. Force
  // the client into a "running" state immediately (even before the action
  // resolves, via the optimistic formData) so the Step-1 loader + countdown
  // show right away and the polling effect below starts.
  useEffect(() => {
    if (enablingAudit && appEnabled) {
      completingRef.current = false;
      dispatch({ type: "AUDIT_STARTED" });
      setAuditStatus((s) => ({
        ...s,
        running: true,
        failed: false,
        complete: false,
        pageIndex: 0,
        totalPages: 0,
        progress: 0,
        pages: [],
        pageStartedAt: null,
        phase: "discovering",
      }));
    }
  }, [enablingAudit, appEnabled]);

  // Toggle OFF, missing embed, or extension_required: stay on Step 1.
  // Never keep a leftover auditComplete jump from sending the merchant to Step 2.
  useEffect(() => {
    if (appEnabled && !extensionBlocked) return;
    dispatch({ type: "RESET" });
    setAuditStatus((s) => (s?.running || s?.failed ? { ...s, running: false, failed: false } : s));
  }, [appEnabled, extensionBlocked]);

  useEffect(() => {
    if (!auditInProgress) return;
    if (auditStatus?.complete || auditStatus?.failed) return;

    let cancelled = false;
    const poll = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const headers = auditStatusEtagRef.current
          ? { "If-None-Match": auditStatusEtagRef.current }
          : undefined;
        const res = await fetch(`/api/audit/status${window.location.search}`, {
          headers,
        });
        if (res.status === 304 || cancelled) return;
        if (!res.ok) return;
        const nextEtag = res.headers.get("ETag");
        if (nextEtag) auditStatusEtagRef.current = nextEtag;
        const data = await res.json();
        setAuditStatus((prev) => {
          if (!data.running && !data.complete && !data.failed) {
            return { ...prev, ...data, running: true };
          }
          return data;
        });
        if (data.complete) {
          if (!completingRef.current && appEnabled && !extensionBlocked) {
            completingRef.current = true;
            void revalidator.revalidate();
            dispatch({ type: "AUDIT_COMPLETE" });
          }
        } else if (data.failed) {
          dispatch({ type: "AUDIT_FAILED" });
        }
      } catch {
        // transient poll failure — keep showing the loader and keep polling
      }
    };

    const pollMs =
      auditStatus?.phase === "queued" ? DASHBOARD_QUEUED_POLL_MS : DASHBOARD_ACTIVE_POLL_MS;

    auditPollingRef.current = true;
    const onVisible = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    poll();
    const timer = setInterval(poll, pollMs);
    return () => {
      cancelled = true;
      auditPollingRef.current = false;
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [
    auditInProgress,
    auditStatus?.complete,
    auditStatus?.failed,
    auditStatus?.phase,
    appEnabled,
    extensionBlocked,
    revalidator,
  ]);

  const goToStep = (step) => {
    // Clamp to the highest allowed step — cannot skip past the app gate.
    dispatch({ type: "GO_TO_STEP", step: Math.min(Math.max(step, 1), maxStep) });
  };

  return (
    <s-page heading="Performance Improvement">
      <h2 ref={stepHeadingRef} tabIndex={-1} className="pp-visually-hidden">
        {stepHeadingLabel(currentStep)}
      </h2>
      <WizardProgress currentStep={currentStep} maxStep={maxStep} onStepClick={goToStep} />

      {currentStep === 1 && (
        <Step1Activate
          config={config}
          shopDomain={shopDomain}
          readOnly={adminManaged}
          auditStatus={auditStatus}
          embedEnabled={embedEnabled}
          embedStatus={embedStatus}
          embedActivateUrl={embedActivateUrl}
          selectedThemeId={selectedThemeId}
          passwordProtected={passwordProtected}
          onAuditRestarted={handleAuditRestarted}
        />
      )}
      {currentStep === 2 && (
        <>
          <Step2Configure
            config={liveConfig}
            auditStatus={auditStatus}
            appEnabled={appEnabled}
            configVersion={configVersion}
            readOnly={adminManaged}
          />
        </>
      )}

      <WizardNavigation currentStep={currentStep} maxStep={maxStep} onChange={goToStep} />

      <FooterBranding />
    </s-page>
  );
}

export function ErrorBoundary() {
  return <RouteErrorBoundary error={useRouteError()} />;
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
