/* eslint-disable @typescript-eslint/no-explicit-any -- fetcher data is untyped at the boundary */
/* Custom PLP/PDP and extra-page URL fields (Step 1). */
import { useState } from "react";
import { MAX_EXTRA_PAGES } from "../../lib/constants.ts";
import { normalizeCustomUrl } from "../../lib/page-urls-shared.ts";
import { describedBy, errorId } from "../../lib/a11y.ts";
import { messages } from "../../lib/messages.ts";

interface Props {
  plpDraft: string;
  pdpDraft: string;
  extraDrafts: string[];
  urlFetcher: any;
  shopDomain?: string;
  pageErrors: Record<number, string>;
  urlsDirty: boolean;
  setPlpDraft: (v: string) => void;
  setPdpDraft: (v: string) => void;
  setExtraRow: (index: number, value: string) => void;
  addExtraRow: () => void;
  removeExtraRow: (index: number) => void;
  handleSaveUrls: () => void;
  readOnly?: boolean;
}

type BlurErrors = { plp?: string; pdp?: string; extra?: Record<number, string | undefined> };

export default function CustomUrlFields({
  plpDraft,
  pdpDraft,
  extraDrafts,
  urlFetcher,
  shopDomain = "",
  pageErrors,
  urlsDirty,
  setPlpDraft,
  setPdpDraft,
  setExtraRow,
  addExtraRow,
  removeExtraRow,
  handleSaveUrls,
  readOnly = false,
}: Props) {
  const [blurErrors, setBlurErrors] = useState<BlurErrors>({});

  const validate = (value: string, kind: "plp" | "pdp" | "page") =>
    shopDomain ? normalizeCustomUrl(value, shopDomain, kind).error : undefined;

  const onBlurPlp = () => {
    const error = plpDraft.trim() ? validate(plpDraft, "plp") : undefined;
    setBlurErrors((prev) => ({ ...prev, plp: error }));
  };
  const onBlurPdp = () => {
    const error = pdpDraft.trim() ? validate(pdpDraft, "pdp") : undefined;
    setBlurErrors((prev) => ({ ...prev, pdp: error }));
  };
  const onBlurExtra = (index: number, value: string) => {
    const error = value.trim() ? validate(value, "page") : undefined;
    setBlurErrors((prev) => ({
      ...prev,
      extra: { ...(prev.extra ?? {}), [index]: error },
    }));
  };

  const plpError = blurErrors.plp || urlFetcher.data?.plpError;
  const pdpError = blurErrors.pdp || urlFetcher.data?.pdpError;
  const busy = urlFetcher.state !== "idle";

  return (
    <div
      style={{
        flex: "2 1 420px",
        backgroundColor: "#f5f5f5",
        borderRadius: 8,
        padding: 16,
        minWidth: 360,
      }}
    >
      <div style={{ fontSize: 16, fontWeight: 700, color: "#222222", marginBottom: 12 }}>
        {messages.urlWeekExample}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <s-text-field
              id="plp-url"
              label="PLP URL (Collection Page)"
              labelAccessibilityVisibility="exclusive"
              placeholder="/collections/all"
              value={plpDraft}
              disabled={readOnly}
              aria-invalid={Boolean(plpError)}
              aria-describedby={describedBy("plp-url", Boolean(plpError))}
              onChange={(e: any) => setPlpDraft(e.target.value)}
              onBlur={onBlurPlp}
            />
            {plpError && (
              <s-text id={errorId("plp-url")} tone="critical" aria-live="polite">
                {plpError}
              </s-text>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <s-text-field
              id="pdp-url"
              label="PDP URL (Product Page)"
              labelAccessibilityVisibility="exclusive"
              placeholder="/products/your-product"
              value={pdpDraft}
              disabled={readOnly}
              aria-invalid={Boolean(pdpError)}
              aria-describedby={describedBy("pdp-url", Boolean(pdpError))}
              onChange={(e: any) => setPdpDraft(e.target.value)}
              onBlur={onBlurPdp}
            />
            {pdpError && (
              <s-text id={errorId("pdp-url")} tone="critical" aria-live="polite">
                {pdpError}
              </s-text>
            )}
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <s-button
              variant="secondary"
              icon="plus"
              accessibilityLabel="Add another page to audit"
              class="pp-focus-ring"
              disabled={readOnly || extraDrafts.length >= MAX_EXTRA_PAGES}
              onClick={addExtraRow}
            />
            <s-button
              variant="secondary"
              class="pp-focus-ring"
              disabled={readOnly || !urlsDirty || busy}
              aria-busy={busy}
              onClick={handleSaveUrls}
            >
              {busy ? messages.saving : "Save"}
            </s-button>
          </div>
        </div>

        {extraDrafts.length > 0 && (
          <s-text tone="subdued">
            Up to {MAX_EXTRA_PAGES} extra pages. Each page adds time to the scan.
          </s-text>
        )}
        {urlFetcher.data?.tooManyPages && (
          <s-text tone="critical" aria-live="polite">
            You can add up to {MAX_EXTRA_PAGES} extra pages. Remove a row and try again.
          </s-text>
        )}
        {extraDrafts.map((draft: any, index: number) => {
          const rowError = blurErrors.extra?.[index] || pageErrors[index + 1];
          const fieldId = `extra-url-${index + 1}`;
          return (
            <div key={index} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <s-text-field
                  id={fieldId}
                  label={`Additional page ${index + 1}`}
                  labelAccessibilityVisibility="exclusive"
                  placeholder="/pages/about"
                  name="customPageUrls"
                  value={draft}
                  disabled={readOnly}
                  aria-invalid={Boolean(rowError)}
                  aria-describedby={describedBy(fieldId, Boolean(rowError))}
                  onChange={(e: any) => setExtraRow(index, e.target.value)}
                  onBlur={(e: any) => onBlurExtra(index, e.target.value)}
                />
                {rowError && (
                  <s-text id={errorId(fieldId)} tone="critical" aria-live="polite">
                    {rowError}
                  </s-text>
                )}
              </div>
              <s-button
                variant="tertiary"
                icon="delete"
                accessibilityLabel={`Remove additional page ${index + 1}`}
                class="pp-focus-ring"
                disabled={readOnly}
                onClick={() => removeExtraRow(index)}
              />
            </div>
          );
        })}
        {!urlsDirty && urlFetcher.data?.ok && (
          <s-text tone="success" role="status" aria-live="polite">
            {messages.saved}
          </s-text>
        )}
        {!urlsDirty && urlFetcher.data?.plpWarning && (
          <s-text tone="caution">{urlFetcher.data.plpWarning}</s-text>
        )}
        {!urlsDirty && urlFetcher.data?.pdpWarning && (
          <s-text tone="caution">{urlFetcher.data.pdpWarning}</s-text>
        )}
      </div>
    </div>
  );
}
