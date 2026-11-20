/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy components */
import { useState, useEffect } from "react";
import { useFetcher } from "react-router";
import Step1AuditRunning from "./step1/Step1AuditRunning.tsx";
import Step1Header from "./step1/Step1Header.tsx";
import CustomUrlFields from "./step1/CustomUrlFields.tsx";
import PasswordBox from "./step1/PasswordBox.tsx";
import Skeleton from "./Skeleton";
import SupportError from "./SupportError";
import { messages } from "../lib/messages.ts";
import { shouldUnlockStep1Setup } from "../lib/first-activation.ts";
import { step1Visibility } from "../lib/step1-visibility.ts";

interface Props {
  config: Record<string, any>;
  shopDomain?: string;
  readOnly?: boolean;
  auditStatus?: any;
  embedEnabled?: boolean;
  embedStatus?: string | null;
  embedActivateUrl?: string | null;
  selectedThemeId?: string | null;
  passwordProtected?: boolean | null;
  onAuditRestarted?: (() => void) | null;
}

// The audit script waits this long on every page it visits.

const ROLE_LABEL = { MAIN: "Live", UNPUBLISHED: "Unpublished", DEMO: "Demo" };

// Audit error codes (StoreConfig.auditError) that mean "the storefront password
// page blocked the scan". They reveal the password box even if detection missed it.
const PASSWORD_BLOCK_MESSAGE = {
  PASSWORD_REQUIRED:
    "Your store is password protected. Enter the storefront password below and we'll scan again.",
  PASSWORD_INCORRECT: "The saved password didn't work. Update it below and we'll scan again.",
};

// "/collections/a-very-long-handle-name-here" -> "/collections/a-v…ere"

/**
 * Step 1 — single toggle: "Enable Performance Improvement App" (app_enabled).
 * Submits immediately via useFetcher (intent: "toggle-app") — does not wait
 * for a later save step.
 *
 * When the app is enabled, the hidden backend audit runs (invisible to the
 * merchant). `auditStatus` reflects that background audit so we can show a
 * spinner below the toggle until it completes.
 */
export default function Step1Activate({
  config,
  auditStatus,
  embedEnabled = false,
  embedStatus = "unknown",
  embedActivateUrl = "",
  selectedThemeId = null,
  passwordProtected = null, // true / false once confirmed, null = still checking
  onAuditRestarted = null,
  readOnly = false,
  shopDomain = "",
}: Props) {
  const fetcher = useFetcher();
  const pwFetcher = useFetcher();
  const urlFetcher = useFetcher();
  const validationFetcher = useFetcher();
  const themesFetcher = useFetcher();
  const selectFetcher = useFetcher();

  // --- Theme picker -------------------------------------------------------
  // The app extension (theme app embed) is installed in ONE theme. The list is
  // fetched on mount so the dashboard loader stays fast.
  useEffect(() => {
    void themesFetcher.load("/api/themes");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const themesLoaded = themesFetcher.data !== undefined;
  const themesFailed = themesLoaded && themesFetcher.data.ok === false;
  const themes = themesFetcher.data?.themes ?? [];
  const savingTheme = selectFetcher.state !== "idle";
  // Selected theme no longer exists (e.g. deleted in Shopify).
  const themeMissing =
    themesLoaded &&
    !themesFailed &&
    Boolean(selectedThemeId) &&
    !themes.some((t: any) => t.id === selectedThemeId);

  // Persisted selection only (not the live-theme default). Save is required before Install.
  const persistedThemeId = themeMissing
    ? ""
    : selectFetcher.data?.ok && selectFetcher.data.selectedThemeId
      ? String(selectFetcher.data.selectedThemeId)
      : selectedThemeId || "";
  const themeSaved =
    themesLoaded &&
    !themesFailed &&
    Boolean(persistedThemeId) &&
    themes.some((t: any) => t.id === persistedThemeId);

  // Local draft: changing the dropdown does not POST until Save.
  const [themeDraftId, setThemeDraftId] = useState("");
  useEffect(() => {
    if (!themesLoaded || themesFailed) return;
    if (selectFetcher.data?.ok && selectFetcher.data.selectedThemeId) {
      setThemeDraftId(String(selectFetcher.data.selectedThemeId));
      return;
    }
    if (selectedThemeId && !themeMissing) {
      setThemeDraftId(selectedThemeId);
      return;
    }
    setThemeDraftId((prev) => prev || themesFetcher.data?.liveThemeId || "");
  }, [
    themesLoaded,
    themesFailed,
    selectedThemeId,
    themeMissing,
    selectFetcher.data,
    themesFetcher.data?.liveThemeId,
  ]);

  const shownTheme = themes.find((t: any) => t.id === (themeDraftId || persistedThemeId));
  const themeName = shownTheme?.name ?? "your theme";
  const themeDirty = Boolean(themeDraftId) && themeDraftId !== persistedThemeId;
  // Fail closed once we know the list: no saved theme => no toggle.
  const themeBlocked = themesLoaded && (themesFailed || themeMissing || !themeSaved);
  const installUrl =
    selectFetcher.data?.ok && selectFetcher.data.selectedThemeId === persistedThemeId
      ? selectFetcher.data.embedActivateUrl
      : embedActivateUrl;

  const handleSaveTheme = () => {
    if (!themeDraftId || savingTheme || !themeDirty) return;
    void selectFetcher.submit(
      { intent: "select-theme", themeId: themeDraftId },
      { method: "POST" },
    );
  };

  const setupUnlocked = shouldUnlockStep1Setup(embedStatus);
  const { showInstall, showSetupControls } = step1Visibility({ themeSaved, setupUnlocked });

  // <s-select> keeps its own value like <s-switch>: remount it from the real
  // value if the save is refused.
  const [selectKey, setSelectKey] = useState(0);
  useEffect(() => {
    if (selectFetcher.data?.ok === false) setSelectKey((k) => k + 1);
  }, [selectFetcher.data]);

  // <s-switch> flips itself visually on click, but our `checked` prop stays
  // false when validation / the toggle-app action refuses, so React never
  // resets it and the switch would sit ON next to the error. Bumping this key
  // remounts the switch from the (still false) `checked` prop => back to OFF.
  const [switchKey, setSwitchKey] = useState(0);
  const resetSwitch = () => setSwitchKey((k) => k + 1);
  // Deriving "validating" from the fetcher's own state (rather than a
  // separate useState) keeps the spinner/disabled state always in sync with
  // the in-flight request, including on late/slow responses.
  const validating = validationFetcher.state !== "idle";

  // Local draft for the storefront password. Never pre-filled with the saved
  // value — the actual password must stay server-side only (CREDENTIAL_BROWSER_LEAKAGE).
  // `hasSavedPassword` tells us whether a password is already stored so we can
  // show "Password saved ✓" without ever sending the value to the browser.
  const [pwDraft, setPwDraft] = useState("");
  const hasSavedPassword =
    pwFetcher.data?.hasStorefrontPassword ?? config.hasStorefrontPassword ?? false;
  // Dirty when the merchant has typed something (any content = new value to save).
  const pwDirty = pwDraft.length > 0;

  // The password box is hidden until protection is confirmed (background
  // check) or an audit was stopped by the password page.
  const passwordBlockCode =
    auditStatus?.failed === true &&
    (PASSWORD_BLOCK_MESSAGE as Record<string, string>)[auditStatus?.error]
      ? auditStatus.error
      : null;
  // Turning the app on was refused because the store turned out to be protected
  // (live check at click time) — reveal the box even if the background check
  // had not answered yet.
  const blockedAtToggle =
    validationFetcher.data?.blockReason === "password_required" ||
    fetcher.data?.error === "password_required";
  const showPasswordBox =
    passwordProtected === true || passwordBlockCode !== null || blockedAtToggle;

  // Password is required if store is protected AND no password saved yet
  const passwordRequired =
    (passwordProtected === true || passwordBlockCode === "PASSWORD_REQUIRED" || blockedAtToggle) &&
    !hasSavedPassword;

  // Main toggle is blocked if password is required but not saved, or if there
  // is no usable theme to install the extension in.
  const mainToggleBlocked = passwordRequired || themeBlocked;

  // Custom URL drafts — one Save writes both fields (matches the card layout).
  const [plpDraft, setPlpDraft] = useState(config.customPlpUrl || "");
  const [pdpDraft, setPdpDraft] = useState(config.customPdpUrl || "");
  // Extra pages added with the "+" button. Kept as a fixed-length list of
  // drafts (never holes) so React keys stay stable when a middle row is removed.
  const [extraDrafts, setExtraDrafts] = useState(
    Array.isArray(config.customPageUrls) ? config.customPageUrls : [],
  );
  const savedExtras = urlFetcher.data?.customPageUrls ?? config.customPageUrls ?? [];
  // Row errors are keyed by 1-based row number by the action, so a merchant
  // with eight rows can tell which one is wrong.
  const pageErrors = urlFetcher.data?.pageErrors ?? {};
  const extrasDirty =
    extraDrafts.length !== savedExtras.length ||
    extraDrafts.some((v: any, i: any) => v !== (savedExtras[i] || ""));
  const savedPlp = urlFetcher.data?.customPlpUrl ?? (config.customPlpUrl || "");
  const savedPdp = urlFetcher.data?.customPdpUrl ?? (config.customPdpUrl || "");
  // extrasDirty is included so the "+" rows can enable Save on their own.
  const urlsDirty = plpDraft !== savedPlp || pdpDraft !== savedPdp || extrasDirty;

  // The server saves a cleaned URL (full https URL on this store, share-link
  // params stripped). Show that value so the fields are not "dirty" afterwards.
  useEffect(() => {
    if (urlFetcher.data?.ok) {
      setPlpDraft(urlFetcher.data.customPlpUrl || "");
      setPdpDraft(urlFetcher.data.customPdpUrl || "");
      setExtraDrafts(
        Array.isArray(urlFetcher.data.customPageUrls) ? urlFetcher.data.customPageUrls : [],
      );
    }
  }, [urlFetcher.data]);

  const handleSavePassword = () => {
    void pwFetcher.submit(
      { intent: "save-storefront-password", storefrontPassword: pwDraft },
      { method: "POST" },
    );
  };

  useEffect(() => {
    if (!pwFetcher.data?.ok) return;
    // Clear the draft after a successful save — the actual password must never
    // be stored in React state. The "Password saved ✓" indicator uses
    // hasSavedPassword (boolean from the action response) instead.
    setPwDraft("");
    if (pwFetcher.data.auditRestarted === true) onAuditRestarted?.();
  }, [pwFetcher.data, onAuditRestarted]);

  const addExtraRow = () => setExtraDrafts((prev: any) => [...prev, ""]);
  const removeExtraRow = (index: any) =>
    setExtraDrafts((prev: any) => prev.filter((_: any, i: any) => i !== index));
  const setExtraRow = (index: any, value: any) =>
    setExtraDrafts((prev: any) => prev.map((v: any, i: any) => (i === index ? value : v)));

  const handleSaveUrls = () => {
    // A real FormData is required, not a plain object. submit({ k: array })
    // serialises the array with String(), so two URLs became ONE entry:
    // "/pages/about,host/collections/sale". The action then accepted that as a
    // single (nonsense) path and the merchant silently lost a page. FormData
    // keeps one entry per key, which is what formData.getAll() reads back.
    const fd = new FormData();
    fd.set("intent", "save-custom-page-urls");
    fd.set("customPlpUrl", plpDraft);
    fd.set("customPdpUrl", pdpDraft);
    for (const v of extraDrafts) {
      if (v.trim() !== "") fd.append("customPageUrls", v);
    }
    void urlFetcher.submit(fd, { method: "POST" });
  };

  // Priority: action response > optimistic formData > loader data.
  // The master switch cannot stay ON until the theme app embed is enabled.
  const rawEnabled =
    fetcher.data?.config?.appEnabled ??
    (fetcher.formData ? fetcher.formData.get("appEnabled") === "true" : config.appEnabled);
  const appEnabled = embedEnabled ? rawEnabled : false;

  // Loader/countdown only while the main toggle is ON. If the switch is
  // off (embed missing, password block, or merchant turned it off), keep
  // existing Step 1 data visible and do not show an in-progress audit.
  const running =
    appEnabled &&
    auditStatus?.running === true &&
    auditStatus?.complete !== true &&
    auditStatus?.failed !== true;
  const failed = appEnabled && auditStatus?.failed === true;

  // Audit progress comes from the server (real phases, no guessed timers):
  // discovering pages -> scanning them (in parallel, `pageIndex` = pages
  // finished) -> building the storefront script. Step 2 only opens once the
  // script is stored.
  const auditPages = Array.isArray(auditStatus?.pages) ? auditStatus.pages : [];
  // The "only N found" hint is about the collection/product pages specifically.
  // Counting rows would be wrong now that merchant-added pages are in the same
  // list: home + PLP + 1 extra is 3 rows yet still no PDP.
  const missingPlp = !auditPages.some((p: any) => p.label === "Collection page");
  const missingPdp = !auditPages.some((p: any) => p.label === "Product page");
  const totalPages = auditStatus?.totalPages > 0 ? auditStatus.totalPages : 0;
  const donePages = Math.min(Math.max(0, auditStatus?.pageIndex ?? 0), totalPages);
  const phase = auditStatus?.phase || (auditStatus?.queue ? "queued" : "discovering");
  const queue = auditStatus?.queue;

  // Turning the app ON starts the audit on the server. Show a loader from the
  // click itself — validation and the toggle request both finish before
  // auditStatus.running flips — so the merchant sees that a scan is coming.
  const toggleTurningOn =
    validating || (fetcher.state !== "idle" && fetcher.formData?.get("appEnabled") === "true");
  const waitingForAudit =
    appEnabled &&
    fetcher.data?.auditStarted === true &&
    !running &&
    !failed &&
    auditStatus?.complete !== true;
  const showStartLoader = toggleTurningOn || waitingForAudit;
  const progressPct =
    phase === "queued"
      ? 2
      : phase === "building"
        ? 92
        : phase === "auditing"
          ? 10 + (totalPages > 0 ? (donePages / totalPages) * 75 : 0)
          : 5;
  const queuedLabel = queue?.queuePosition
    ? `Waiting in queue (position ${queue.queuePosition} of ${queue.queueDepth})`
    : "Waiting in queue…";
  const etaLabel =
    queue?.estimatedWaitMinutes != null && queue.estimatedWaitMinutes > 0
      ? `Estimated wait ~${queue.estimatedWaitMinutes} min`
      : null;
  const auditSteps = [
    ...(phase === "queued"
      ? [
          {
            key: "queued",
            label: etaLabel ? `${queuedLabel} — ${etaLabel}` : queuedLabel,
          },
        ]
      : []),
    {
      key: "discovering",
      label:
        auditPages.length > 0
          ? `Found ${auditPages.length} page${auditPages.length === 1 ? "" : "s"} to scan`
          : "Finding pages to scan",
    },
    {
      key: "auditing",
      label:
        totalPages > 0 ? `Scanning pages (${donePages} of ${totalPages} done)` : "Scanning pages",
    },
    { key: "building", label: "Building your optimized script" },
  ];
  const activeStepIndex = auditSteps.findIndex((st) => st.key === phase);

  useEffect(() => {
    if (!urlsDirty && !pwDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = messages.unsavedChanges;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [urlsDirty, pwDirty]);

  const focusPasswordField = () => {
    const pwField = document.querySelector(
      'input[placeholder*="storefront password" i], input[name="storefrontPassword"]',
    );
    pwField?.scrollIntoView({ behavior: "smooth", block: "center" });
    (pwField as HTMLElement | null)?.focus({ preventScroll: true });
  };

  const openThemeEditor = (url: any) => {
    if (url) {
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      window.location.assign("/app/extension?from=toggle");
    }
  };

  // Fail-closed toggle-ON: the switch never flips ON from the click itself.
  // A live validation round-trip (app embed + password protection, both
  // re-checked at click time) has to come back `allowed: true` before we
  // submit the real toggle-app action. Any failure, timeout, or unexpected
  // response leaves the toggle OFF.
  const handleToggle = (checked: any) => {
    if (!checked) {
      // OFF is always allowed immediately — no validation needed.
      void fetcher.submit({ intent: "toggle-app", appEnabled: "false" }, { method: "POST" });
      return;
    }

    // Fast client-side check against the last-known loader data, so an
    // obviously-blocked toggle doesn't even wait on a round trip.
    if (mainToggleBlocked) {
      if (passwordRequired) focusPasswordField();
      return;
    }

    if (validating) return; // no double-submit while a check is in flight

    void validationFetcher.submit(
      { intent: "validate-toggle" },
      { method: "POST", action: "/api/toggle-validate" },
    );
  };

  // Acts on the validation result once it comes back.
  useEffect(() => {
    if (validationFetcher.state !== "idle" || !validationFetcher.data) return;
    const result = validationFetcher.data;

    if (!result?.allowed) {
      // FAIL-CLOSED: toggle never flips ON. Take the corrective action for
      // whichever check failed (or, for an unrecognized/empty response,
      // just leave the toggle OFF with the generic banner below).
      resetSwitch();
      if (result?.blockReason === "extension_required") {
        openThemeEditor(result.embedActivateUrl || embedActivateUrl);
      } else if (result?.blockReason === "password_required") {
        focusPasswordField();
      }
      return;
    }

    // Validation passed — proceed with the real toggle-app submit.
    void fetcher.submit({ intent: "toggle-app", appEnabled: "true" }, { method: "POST" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [validationFetcher.state, validationFetcher.data]);

  // Server-side guard: the dashboard's embed/password status can be stale
  // (e.g. the client validation was bypassed or the status check failed and
  // the loader assumed enabled). If the toggle-app action itself blocks,
  // take the same corrective action as the client-side validation does.
  useEffect(() => {
    // Any refused/failed toggle-app response leaves the switch OFF.
    if (fetcher.data?.ok === false) resetSwitch();
    if (fetcher.data?.error === "extension_required") {
      openThemeEditor(fetcher.data?.embedActivateUrl || embedActivateUrl);
    } else if (fetcher.data?.error === "password_required") {
      focusPasswordField();
    }
  }, [fetcher.data, embedActivateUrl]);

  return (
    <s-section heading="Step 1: Activate">
      <s-stack direction="block" gap="base">
        <Step1Header />

        {/* Theme picker: which theme gets the app extension */}
        <div
          style={{
            margin: "0 auto",
            // content-box: 16px padding is added to the width, so subtract it
            // here or the box overflows its container on narrow screens.
            width: "calc(100% - 32px)",
            maxWidth: 470,
            backgroundColor: "#f5f5f5",
            borderRadius: 8,
            padding: 16,
          }}
        >
          <div
            style={{
              fontSize: 16,
              fontWeight: 700,
              color: "#222222",
              marginBottom: 12,
            }}
          >
            Choose the theme for the app extension
          </div>
          {!themesLoaded ? (
            <Skeleton lines={2} label="Loading themes" />
          ) : themesFailed ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <s-text tone="critical">Couldn&apos;t load your themes.</s-text>
              <s-button variant="secondary" onClick={() => themesFetcher.load("/api/themes")}>
                Retry
              </s-button>
            </div>
          ) : (
            <>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "flex-end",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  <s-select
                    key={selectKey}
                    label="Theme"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Select a theme"
                    value={themeDraftId}
                    disabled={savingTheme || readOnly}
                    onChange={(e: any) => setThemeDraftId(e.target.value)}
                  >
                    {themes.map((t: any) => (
                      <s-option key={t.id} value={t.id}>
                        {`${t.name} (${(ROLE_LABEL as Record<string, string>)[t.role] || t.role})`}
                      </s-option>
                    ))}
                  </s-select>
                </div>
                <s-button
                  variant="primary"
                  disabled={!themeDraftId || !themeDirty || savingTheme || readOnly}
                  onClick={handleSaveTheme}
                >
                  Save
                </s-button>
                {showInstall && (
                  <s-button
                    variant={embedStatus === "enabled" ? "secondary" : "primary"}
                    disabled={!persistedThemeId || savingTheme}
                    onClick={() => openThemeEditor(installUrl)}
                  >
                    {embedStatus === "enabled"
                      ? "Open theme editor"
                      : "Install extension in this theme"}
                  </s-button>
                )}
              </div>

              <div style={{ marginTop: 8 }}>
                {savingTheme ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <s-spinner size="small" />
                    <s-text tone="subdued">Saving {themeName}…</s-text>
                  </div>
                ) : themeMissing ? (
                  <s-text tone="caution">
                    The theme you chose earlier no longer exists. Choose another theme.
                  </s-text>
                ) : selectFetcher.data?.ok === false ? (
                  <s-text tone="critical">{selectFetcher.data.error}</s-text>
                ) : !themeSaved ? (
                  <s-text tone="caution">
                    Choose a theme and click Save before installing the extension.
                  </s-text>
                ) : embedStatus === "enabled" ? (
                  <s-text tone="success">✔ Extension is enabled in “{themeName}”.</s-text>
                ) : embedStatus === "disabled" ? (
                  <s-text tone="caution">
                    Extension is not enabled in “{themeName}”. Install it, turn it on and save in
                    the theme editor, then come back here.
                  </s-text>
                ) : (
                  <s-text tone="caution">
                    We couldn&apos;t verify the extension in “{themeName}”, so the app stays off
                    until we can.
                  </s-text>
                )}
              </div>
            </>
          )}
        </div>

        {/* Brand illustration — decorative; does not unlock setup */}
        <div style={{ textAlign: "center", margin: "24px 0" }}>
          <img
            src="/Glossy-Performance.avif"
            alt="PagePulse performance"
            style={{ width: 220, height: "auto", maxHeight: 100, objectFit: "cover" }}
          />
        </div>

        {showSetupControls && (
          <>
            {readOnly && (
              <s-banner tone="critical" role="alert">
                {messages.readOnly}
              </s-banner>
            )}

            {/* Toggle instruction */}
            <div style={{ textAlign: "center", fontSize: 16, color: "#333333" }}>
              Improve loading speed, enhance the customer experience, and boost conversions — just
              turn this ON 👇
            </div>

            {/* Toggle. A loader sits beside it from the moment it is turned on,
            before the audit status poll reports a running scan. */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <s-switch
                key={switchKey}
                label="Enable Performance Improvement App"
                checked={appEnabled}
                disabled={readOnly || mainToggleBlocked || validating}
                onChange={(e: any) => handleToggle(e.target.checked)}
              />

              {(showStartLoader || running) && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 8,
                    fontSize: 13,
                    color: "#4A5568",
                  }}
                >
                  <s-spinner size="small" />
                  {running ? "Audit in progress" : "Audit will start soon"}
                </span>
              )}
            </div>

            {/* Show message if blocked due to password (stale loader data) */}
            {passwordRequired && !validating && (
              <s-text tone="caution">
                Save your storefront password below before enabling the app.
              </s-text>
            )}
            {themeBlocked && !passwordRequired && !validating && (
              <s-text tone="caution">
                Choose a theme for the app extension above before enabling the app.
              </s-text>
            )}

            {/* Validation failed at click time — explain why the toggle
              stayed OFF and what corrective action was taken. */}
            {!validating && validationFetcher.data?.allowed === false && (
              <s-banner tone="critical">
                {validationFetcher.data.blockReason === "extension_required" &&
                  "App extension not enabled. Opening the theme editor…"}
                {validationFetcher.data.blockReason === "password_required" &&
                  "Store is password protected. Save your storefront password below."}
                {!["extension_required", "password_required"].includes(
                  validationFetcher.data.blockReason,
                ) && "Couldn't verify store setup in time. Please try again."}
              </s-banner>
            )}

            {/* Password + custom PLP/PDP URL cards — side by side */}
            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "stretch",
                flexWrap: "wrap",
                margin: "0 0 16px 0",
              }}
            >
              {/* Hidden until password protection is confirmed (or an audit hit the password page) */}
              <PasswordBox
                showPasswordBox={showPasswordBox}
                passwordBlockCode={passwordBlockCode}
                pwDraft={pwDraft}
                setPwDraft={setPwDraft}
                pwFetcher={pwFetcher}
                hasSavedPassword={hasSavedPassword}
                handleSavePassword={handleSavePassword}
                readOnly={readOnly}
              />

              <CustomUrlFields
                plpDraft={plpDraft}
                pdpDraft={pdpDraft}
                extraDrafts={extraDrafts}
                urlFetcher={urlFetcher}
                shopDomain={shopDomain}
                pageErrors={pageErrors}
                urlsDirty={urlsDirty}
                setPlpDraft={setPlpDraft}
                setPdpDraft={setPdpDraft}
                setExtraRow={setExtraRow}
                addExtraRow={addExtraRow}
                removeExtraRow={removeExtraRow}
                handleSaveUrls={handleSaveUrls}
                readOnly={readOnly}
              />
            </div>

            {running && (
              <Step1AuditRunning
                auditSteps={auditSteps}
                activeStepIndex={activeStepIndex}
                progressPct={progressPct}
                auditPages={auditPages}
                phase={auditStatus?.phase}
                missingPlp={missingPlp}
                missingPdp={missingPdp}
              />
            )}
            {failed && !passwordBlockCode && (
              <div
                style={{
                  textAlign: "center",
                  padding: "8px 0",
                  color: "#C62828",
                  fontSize: 13,
                }}
              >
                {auditStatus?.errorMessage ||
                  `Audit failed: ${auditStatus?.error || "unknown error"}`}
                <SupportError
                  title="The scan didn't finish"
                  error={auditStatus?.errorMessage}
                  code={auditStatus?.error}
                  shopDomain={shopDomain}
                  onRetry={() => {
                    void fetcher.submit(
                      { intent: "start-audit", appEnabled: "true" },
                      { method: "POST" },
                    );
                  }}
                />
              </div>
            )}
          </>
        )}
      </s-stack>
    </s-section>
  );
}
