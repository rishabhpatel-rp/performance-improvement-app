/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

// The audit script waits this long on every page it visits.

const ROLE_LABEL = { MAIN: "Live", UNPUBLISHED: "Unpublished", DEMO: "Demo" };

// "/collections/a-very-long-handle-name-here" -> "/collections/a-v…ere"
function shortPath(path, max = 40) {
  if (!path || path.length <= max) return path || "";
  const half = Math.floor((max - 1) / 2);
  return `${path.slice(0, half)}…${path.slice(-half)}`;
}

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
  passwordProtected = false,
}) {
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
    themesFetcher.load("/api/themes");
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
    !themes.some((t) => t.id === selectedThemeId);
  // In-flight choice -> saved choice -> live theme.
  const shownThemeId = themeMissing
    ? ""
    : (selectFetcher.formData?.get("themeId") ??
      selectedThemeId ??
      themesFetcher.data?.liveThemeId ??
      "");
  const shownTheme = themes.find((t) => t.id === shownThemeId);
  const themeName = shownTheme?.name ?? "your theme";
  // Fail closed once we know the list: no usable theme => no toggle.
  const themeBlocked =
    themesLoaded && (themesFailed || themeMissing || !shownThemeId);
  const installUrl =
    selectFetcher.data?.ok && selectFetcher.data.selectedThemeId === shownThemeId
      ? selectFetcher.data.embedActivateUrl
      : embedActivateUrl;

  const handleSelectTheme = (themeId) => {
    if (!themeId || themeId === shownThemeId || savingTheme) return;
    selectFetcher.submit(
      { intent: "select-theme", themeId },
      { method: "POST" },
    );
  };

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

  // Local draft for the storefront password, seeded from the saved value.
  const [pwDraft, setPwDraft] = useState(config.storefrontPassword || "");
  const savedPassword =
    pwFetcher.data?.storefrontPassword ?? (config.storefrontPassword || "");
  const pwDirty = pwDraft !== savedPassword;

  // Password is required if store is protected AND no password saved yet
  const passwordRequired = passwordProtected && !savedPassword;

  // Main toggle is blocked if password is required but not saved, or if there
  // is no usable theme to install the extension in.
  const mainToggleBlocked = passwordRequired || themeBlocked;

  // Custom URL drafts — one Save writes both fields (matches the card layout).
  const [plpDraft, setPlpDraft] = useState(config.customPlpUrl || "");
  const [pdpDraft, setPdpDraft] = useState(config.customPdpUrl || "");
  const savedPlp = urlFetcher.data?.customPlpUrl ?? (config.customPlpUrl || "");
  const savedPdp = urlFetcher.data?.customPdpUrl ?? (config.customPdpUrl || "");
  const urlsDirty = plpDraft !== savedPlp || pdpDraft !== savedPdp;

  // The server saves a cleaned URL (full https URL on this store, share-link
  // params stripped). Show that value so the fields are not "dirty" afterwards.
  useEffect(() => {
    if (urlFetcher.data?.ok) {
      setPlpDraft(urlFetcher.data.customPlpUrl || "");
      setPdpDraft(urlFetcher.data.customPdpUrl || "");
    }
  }, [urlFetcher.data]);

  const handleSavePassword = () => {
    pwFetcher.submit(
      { intent: "save-storefront-password", storefrontPassword: pwDraft },
      { method: "POST" },
    );
  };

  const handleSaveUrls = () => {
    urlFetcher.submit(
      {
        intent: "save-custom-page-urls",
        customPlpUrl: plpDraft,
        customPdpUrl: pdpDraft,
      },
      { method: "POST" },
    );
  };

  // Priority: action response > optimistic formData > loader data.
  // The master switch cannot stay ON until the theme app embed is enabled.
  const rawEnabled =
    fetcher.data?.config?.appEnabled ??
    (fetcher.formData
      ? fetcher.formData.get("appEnabled") === "true"
      : config.appEnabled);
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
  const totalPages = auditStatus?.totalPages > 0 ? auditStatus.totalPages : 0;
  const donePages = Math.min(Math.max(0, auditStatus?.pageIndex ?? 0), totalPages);
  const phase = auditStatus?.phase || "discovering";
  const progressPct =
    phase === "building"
      ? 92
      : phase === "auditing"
        ? 10 + (totalPages > 0 ? (donePages / totalPages) * 75 : 0)
        : 5;
  const auditSteps = [
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
        totalPages > 0
          ? `Scanning pages (${donePages} of ${totalPages} done)`
          : "Scanning pages",
    },
    { key: "building", label: "Building your optimized script" },
  ];
  const activeStepIndex = auditSteps.findIndex((st) => st.key === phase);

  const focusPasswordField = () => {
    const pwField = document.querySelector(
      'input[placeholder*="storefront password" i], input[name="storefrontPassword"]',
    );
    pwField?.scrollIntoView({ behavior: "smooth", block: "center" });
    pwField?.focus({ preventScroll: true });
  };

  const openThemeEditor = (url) => {
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
  const handleToggle = (checked) => {
    if (!checked) {
      // OFF is always allowed immediately — no validation needed.
      fetcher.submit(
        { intent: "toggle-app", appEnabled: "false" },
        { method: "POST" },
      );
      return;
    }

    // Fast client-side check against the last-known loader data, so an
    // obviously-blocked toggle doesn't even wait on a round trip.
    if (mainToggleBlocked) {
      if (passwordRequired) focusPasswordField();
      return;
    }

    if (validating) return; // no double-submit while a check is in flight

    validationFetcher.submit(
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
    fetcher.submit(
      { intent: "toggle-app", appEnabled: "true" },
      { method: "POST" },
    );
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.data, embedActivateUrl]);

  return (
    <s-section heading="Step 1: Activate">
      <s-stack direction="block" gap="base">
        {/* Header */}
        <div style={{ textAlign: "center", padding: "16px 0" }}>
          <h2
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: "#222222",
              margin: 0,
            }}
          >
            ⚡ Make your store faster, starting now
          </h2>
        </div>

        {/* Green callout banner */}
        <div
          style={{
            margin: "16px auto",
            maxWidth: "90%",
            padding: "16px 20px",
            backgroundColor: "#E8F8F0",
            borderTop: "4px solid #00C853",
            borderRadius: 4,
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              borderRadius: "50%",
              backgroundColor: "#00C853",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontSize: 14,
              flexShrink: 0,
            }}
          >
            ✔
          </div>
          <div>
            <div
              style={{
                fontSize: 15,
                fontWeight: 700,
                color: "#1E3A2B",
                marginBottom: 4,
              }}
            >
              A powerful speed app without the expensive price tag?
            </div>
            <div style={{ fontSize: 13, color: "#4A5568" }}>
              We&apos;re committed to helping Shopify merchants build faster,
              better-performing stores.
            </div>
          </div>
        </div>

        {/* Theme picker: which theme gets the app extension */}
        <div
          style={{
            margin: "0 auto",
            width: "100%",
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
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <s-spinner size="small" />
              <s-text tone="subdued">Loading themes…</s-text>
            </div>
          ) : themesFailed ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <s-text tone="critical">
                Couldn&apos;t load your themes.
              </s-text>
              <s-button
                variant="secondary"
                onClick={() => themesFetcher.load("/api/themes")}
              >
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
                    value={shownThemeId}
                    disabled={savingTheme}
                    onChange={(e) => handleSelectTheme(e.target.value)}
                  >
                    {themes.map((t) => (
                      <s-option key={t.id} value={t.id}>
                        {`${t.name} (${ROLE_LABEL[t.role] || t.role})`}
                      </s-option>
                    ))}
                  </s-select>
                </div>
                <s-button
                  variant={embedStatus === "enabled" ? "secondary" : "primary"}
                  disabled={!shownThemeId || savingTheme}
                  onClick={() => openThemeEditor(installUrl)}
                >
                  {embedStatus === "enabled"
                    ? "Open theme editor"
                    : "Install extension in this theme"}
                </s-button>
              </div>

              <div style={{ marginTop: 8 }}>
                {savingTheme ? (
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <s-spinner size="small" />
                    <s-text tone="subdued">Checking {themeName}…</s-text>
                  </div>
                ) : themeMissing ? (
                  <s-text tone="caution">
                    The theme you chose earlier no longer exists. Choose another
                    theme.
                  </s-text>
                ) : selectFetcher.data?.ok === false ? (
                  <s-text tone="critical">{selectFetcher.data.error}</s-text>
                ) : embedStatus === "enabled" ? (
                  <s-text tone="success">
                    ✔ Extension is enabled in “{themeName}”.
                  </s-text>
                ) : embedStatus === "disabled" ? (
                  <s-text tone="caution">
                    Extension is not enabled in “{themeName}”. Install it, turn
                    it on and save in the theme editor, then come back here.
                  </s-text>
                ) : (
                  <s-text tone="caution">
                    We couldn&apos;t verify the extension in “{themeName}”, so
                    the app stays off until we can.
                  </s-text>
                )}
              </div>
            </>
          )}
        </div>

        {/* Rocket illustration */}
        <div style={{ textAlign: "center", margin: "24px 0" }}>
          <div style={{ fontSize: 64 }}>🚀</div>
        </div>

        {/* Toggle instruction */}
        <div style={{ textAlign: "center", fontSize: 16, color: "#333333" }}>
          Improve loading speed, enhance the customer experience, and boost
          conversions — just turn this ON 👇
        </div>

        {/* Toggle switch */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: 8 }}>
          <s-switch
            key={switchKey}
            label="Enable Performance Improvement App"
            checked={appEnabled}
            disabled={mainToggleBlocked || validating}
            onChange={(e) => handleToggle(e.target.checked)}
          />

          {/* Validating: live-checking app embed + password status (<3s) */}
          {validating && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <s-spinner size="small" />
              <s-text tone="subdued">Checking store setup…</s-text>
            </div>
          )}

          {/* Show message if blocked due to password (stale loader data) */}
          {passwordRequired && !validating && (
            <s-text tone="caution">
              Save your storefront password below before enabling the app.
            </s-text>
          )}
          {themeBlocked && !passwordRequired && !validating && (
            <s-text tone="caution">
              Choose a theme for the app extension above before enabling the
              app.
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
              ) &&
                "Couldn't verify store setup in time. Please try again."}
            </s-banner>
          )}
        </div>

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
          {/* Only show if password protection is detected */}
          {passwordProtected && (
            <div
              style={{
                flex: "1 1 280px",
                backgroundColor: "#f5f5f5",
                borderRadius: 8,
                padding: 16,
                minWidth: 260,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: "#222222" }}>
                  Password-protected store detected
                </div>
                {/* Toggle always ON and disabled - informational only */}
                <s-switch label="" checked={true} disabled />
              </div>

              <s-text tone="caution" style={{ marginBottom: 8 }}>
                
              </s-text>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <s-text-field
                    type="text"
                    label="Storefront password"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="Enter storefront password (required)"
                    value={pwDraft}
                    onChange={(e) => setPwDraft(e.target.value)}
                    required
                  />
                </div>
                <s-button
                  variant="secondary"
                  disabled={!pwDraft || !pwDirty || pwFetcher.state !== "idle"}
                  onClick={handleSavePassword}
                >
                  {pwFetcher.state !== "idle" ? "Saving…" : "Save"}
                </s-button>
              </div>
              {!pwDirty && savedPassword && (
                <s-text tone="success">Password saved</s-text>
              )}
            </div>
          )}

          <div
            style={{
              flex: "2 1 420px",
              backgroundColor: "#f5f5f5",
              borderRadius: 8,
              padding: 16,
              minWidth: 360,
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
              Add URL of PLP PDP here or it will take default
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <s-text-field
                    label="PLP URL (Collection Page)"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="/collections/all"
                    value={plpDraft}
                    onChange={(e) => setPlpDraft(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <s-text-field
                    label="PDP URL (Product Page)"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="/products/your-product"
                    value={pdpDraft}
                    onChange={(e) => setPdpDraft(e.target.value)}
                  />
                </div>
                <s-button
                  variant="secondary"
                  disabled={!urlsDirty || urlFetcher.state !== "idle"}
                  onClick={handleSaveUrls}
                >
                  {urlFetcher.state !== "idle" ? "Saving…" : "Save"}
                </s-button>
              </div>
              {urlFetcher.data?.plpError && (
                <s-text tone="critical">
                  Collection page: {urlFetcher.data.plpError}
                </s-text>
              )}
              {urlFetcher.data?.pdpError && (
                <s-text tone="critical">
                  Product page: {urlFetcher.data.pdpError}
                </s-text>
              )}
              {!urlsDirty && urlFetcher.data?.ok && (
                <s-text tone="success">Saved</s-text>
              )}
              {!urlsDirty && urlFetcher.data?.plpWarning && (
                <s-text tone="caution">{urlFetcher.data.plpWarning}</s-text>
              )}
              {!urlsDirty && urlFetcher.data?.pdpWarning && (
                <s-text tone="caution">{urlFetcher.data.pdpWarning}</s-text>
              )}
            </div>
          </div>
        </div>

        {/* Hidden backend audit feedback (below the toggle) */}
        {running && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
              padding: "12px 0",
              color: "#4A5568",
              fontSize: 14,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <s-spinner />
              <span>{auditSteps[Math.max(activeStepIndex, 0)].label}…</span>
            </div>

            <div style={{ width: "100%", maxWidth: 360 }}>
              <div
                style={{
                  height: 10,
                  borderRadius: 6,
                  backgroundColor: "#E2E7EC",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${progressPct}%`,
                    backgroundColor: "#00B856",
                    borderRadius: 6,
                    transition: "width 400ms ease",
                  }}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 4,
                fontSize: 13,
                color: "#6B7177",
              }}
            >
              {auditSteps.map((st, i) => {
                const state =
                  i < activeStepIndex
                    ? "done"
                    : i === activeStepIndex
                      ? "current"
                      : "pending";
                return (
                  <div
                    key={st.key}
                    style={{
                      fontWeight: state === "current" ? 600 : 400,
                      color: state === "pending" ? "#8A9099" : "#1E3A2B",
                    }}
                  >
                    {state === "done" ? "✓" : state === "current" ? "●" : "○"}{" "}
                    {st.label}
                  </div>
                );
              })}
            </div>

            {auditPages.length > 0 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  justifyContent: "center",
                }}
              >
                {auditPages.map((p, i) => (
                  <span
                    key={`${p.label}-${i}`}
                    title={p.path}
                    style={{
                      padding: "2px 10px",
                      borderRadius: 12,
                      fontSize: 12,
                      backgroundColor: "#F1F3F5",
                      color: "#1E3A2B",
                    }}
                  >
                    {p.label} · {shortPath(p.path)}
                  </span>
                ))}
              </div>
            )}

            {auditPages.length > 0 && auditPages.length < 3 && (
              <div
                style={{
                  fontSize: 12,
                  color: "#6B7177",
                  textAlign: "center",
                  maxWidth: 420,
                }}
              >
                Only {auditPages.map((p) => p.label).join(" and ")}{" "}
                {auditPages.length === 1 ? "was" : "were"} found on your store.
                Add a collection/product URL below for a fuller audit.
              </div>
            )}
          </div>
        )}
        {failed && (
          <div
            style={{
              textAlign: "center",
              padding: "8px 0",
              color: "#C62828",
              fontSize: 13,
            }}
          >
            Audit failed: {auditStatus?.error || "unknown error"}
          </div>
        )}
      </s-stack>
    </s-section>
  );
}