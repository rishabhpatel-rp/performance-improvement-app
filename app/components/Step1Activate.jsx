/* eslint-disable react/prop-types */
import { useState, useEffect, useRef } from "react";
import { useFetcher } from "react-router";

const DEFAULT_PAGES = 3;
const SECONDS_PER_PAGE = 30;

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
  embedActivateUrl = "",
}) {
  const fetcher = useFetcher();
  const pwFetcher = useFetcher();
  const urlFetcher = useFetcher();

  // Local draft for the storefront password, seeded from the saved value.
  const [pwDraft, setPwDraft] = useState(config.storefrontPassword || "");
  const [pwEnabled, setPwEnabled] = useState(!!config.storefrontPassword);
  const savedPassword =
    pwFetcher.data?.storefrontPassword ?? (config.storefrontPassword || "");
  const pwDirty = pwDraft !== savedPassword;

  // Custom URL drafts — one Save writes both fields (matches the card layout).
  const [plpDraft, setPlpDraft] = useState(config.customPlpUrl || "");
  const [pdpDraft, setPdpDraft] = useState(config.customPdpUrl || "");
  const savedPlp = urlFetcher.data?.customPlpUrl ?? (config.customPlpUrl || "");
  const savedPdp = urlFetcher.data?.customPdpUrl ?? (config.customPdpUrl || "");
  const urlsDirty = plpDraft !== savedPlp || pdpDraft !== savedPdp;

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

  // Show the loader/countdown for the whole audit. Do not require
  // appEnabled — that can lag behind the DB while the audit is already running.
  const running =
    auditStatus?.running === true &&
    auditStatus?.complete !== true &&
    auditStatus?.failed !== true;
  const failed = auditStatus?.failed === true;

  // One clock drives both the bar and the countdown: completed pages from
  // the status poll, plus elapsed time within the current 30s page window.
  const pageStartTimeRef = useRef(Date.now());
  const lastPageIndexRef = useRef(auditStatus?.pageIndex ?? 0);
  const [ui, setUi] = useState({
    progress: 0,
    remaining: DEFAULT_PAGES * SECONDS_PER_PAGE,
  });

  useEffect(() => {
    const totalPages = Math.max(
      1,
      auditStatus?.totalPages > 0 ? auditStatus.totalPages : DEFAULT_PAGES,
    );

    if (!running) {
      pageStartTimeRef.current = Date.now();
      lastPageIndexRef.current = auditStatus?.pageIndex ?? 0;
      setUi({ progress: 0, remaining: totalPages * SECONDS_PER_PAGE });
      return;
    }

    const tick = () => {
      const pages = Math.max(
        1,
        auditStatus?.totalPages > 0 ? auditStatus.totalPages : DEFAULT_PAGES,
      );
      let pageIndex = auditStatus?.pageIndex ?? 0;
      if (pageIndex !== lastPageIndexRef.current) {
        pageStartTimeRef.current = Date.now();
        lastPageIndexRef.current = pageIndex;
      }
      pageIndex = Math.min(Math.max(0, pageIndex), pages - 1);
      const elapsedOnPage = Math.min(
        SECONDS_PER_PAGE,
        (Date.now() - pageStartTimeRef.current) / 1000,
      );
      const pageShare = 100 / pages;
      const progress = Math.min(
        99,
        pageIndex * pageShare + (elapsedOnPage / SECONDS_PER_PAGE) * pageShare,
      );
      const remaining = Math.max(
        0,
        (pages - pageIndex - 1) * SECONDS_PER_PAGE +
          (SECONDS_PER_PAGE - elapsedOnPage),
      );
      setUi({ progress, remaining });
    };

    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [running, auditStatus?.pageIndex, auditStatus?.totalPages]);

  const progressPct = ui.progress;
  const remaining = ui.remaining;
  const page = auditStatus?.pageIndex ?? 0;
  const total =
    auditStatus?.totalPages > 0 ? auditStatus.totalPages : DEFAULT_PAGES;

  const handleToggle = (checked) => {
    if (checked && !embedEnabled) {
      window.open(
        `/app/extension${window.location.search}${
          window.location.search ? "&" : "?"
        }from=toggle`,
        "_blank",
        "noopener,noreferrer",
      );
      return;
    }
    fetcher.submit(
      { intent: "toggle-app", appEnabled: String(checked) },
      { method: "POST" },
    );
  };

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
            label=""
            checked={appEnabled}
            onChange={(e) => handleToggle(e.target.checked)}
          />
          {!embedEnabled && (
            <div style={{ fontSize: 13, color: "#6B7177", textAlign: "center", maxWidth: 420 }}>
              Enable the theme app embed first. Turning this ON opens the
              installation page so you can switch it on in the theme editor.
              {embedActivateUrl ? (
                <>
                  {" "}
                  <a href="/app/extension" style={{ color: "#00B856" }}>
                    Open app extension page
                  </a>
                </>
              ) : null}
            </div>
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
          <div
            style={{
              flex: "1 1 280px",
              backgroundColor: "#f5f5f5",
              borderRadius: 8,
              padding: 16,
              minWidth: 260,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: 16,
                  fontWeight: 700,
                  color: "#222222",
                }}
              >
                Password-protected store?
              </div>
              <s-switch
                label=""
                checked={pwEnabled}
                onChange={(e) => setPwEnabled(e.target.checked)}
              />
            </div>

            {pwEnabled && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <s-text-field
                      type="text"
                      label="Storefront password"
                      labelAccessibilityVisibility="exclusive"
                      placeholder="Storefront password"
                      value={pwDraft}
                      onChange={(e) => setPwDraft(e.target.value)}
                    />
                  </div>
                  <s-button
                    variant="secondary"
                    disabled={!pwDirty || pwFetcher.state !== "idle"}
                    onClick={handleSavePassword}
                  >
                    {pwFetcher.state !== "idle" ? "Saving…" : "Save"}
                  </s-button>
                </div>
                {!pwDirty && pwFetcher.data?.ok && (
                  <s-text tone="success">Saved</s-text>
                )}
              </div>
            )}
          </div>

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
                    placeholder="https://yourstore.com/collections/your-collection"
                    value={plpDraft}
                    onChange={(e) => setPlpDraft(e.target.value)}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <s-text-field
                    label="PDP URL (Product Page)"
                    labelAccessibilityVisibility="exclusive"
                    placeholder="https://yourstore.com/products/your-product"
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
              {!urlsDirty && urlFetcher.data?.ok && (
                <s-text tone="success">Saved</s-text>
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
              <span>
                Running audit… Scanning {Math.min(page + 1, total)}/{Math.max(total, 1)}{" "}
                pages
              </span>
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
                    transition: "width 250ms linear",
                  }}
                />
              </div>
            </div>
            <div style={{ fontSize: 13, color: "#6B7177" }}>
              {Math.ceil(remaining)}s remaining
            </div>
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