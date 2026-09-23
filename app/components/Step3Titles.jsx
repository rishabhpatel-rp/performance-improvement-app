/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

const FIELDS = [
  {
    key: "auditDeferArray",
    enabledKey: "auditDeferArrayEnabled",
    preservedKey: "auditDeferArrayPreserved",
    delayKey: null,
    label: "Defer Heavy Scripts",
    hint: "Scripts/patterns found by the audit to defer loading.",
    placeholder: '["jquery.min.js","cdn.clarity"]',
  },
  {
    key: "auditHideSelectors",
    enabledKey: "auditHideSelectorsEnabled",
    preservedKey: "auditHideSelectorsPreserved",
    delayKey: null,
    label: "Hide Lastfold Classes",
    hint: "CSS selectors for off-screen sections found by the audit.",
    placeholder: '["#footer-links",".product-grid > :nth-child(n+5)"]',
  },
  {
    key: "firstUserDelayScripts",
    enabledKey: "firstUserDelayScriptsEnabled",
    preservedKey: "firstUserDelayScriptsPreserved",
    delayKey: "firstUserDelayMs",
    delayDefault: 12000,
    label: "Delay Scripts for First User",
    hint: "Released on interaction or after delay timeout for first-time visitors.",
    placeholder: '["anime.js"]',
  },
  {
    key: "staticDeferDefaults",
    enabledKey: "staticDeferDefaultsEnabled",
    preservedKey: "staticDeferDefaultsPreserved",
    delayKey: "everyTimeDelayMs",
    delayDefault: 6000,
    label: "Delay Scripts",
    hint: "Released after delay timeout on every page load.",
    placeholder: '["anime.js"]',
  },
];

// Serialize a string array as a pretty JSON array, wrapping each element on
// its own line for readability in the textarea.
function toEditable(value) {
  const arr = Array.isArray(value) ? value : [];
  return JSON.stringify(arr, null, 2);
}

// Strict validation: the textarea must contain a JSON array of strings.
function validateArray(text) {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value) && value.every((x) => typeof x === "string")) {
      return { valid: true, value, error: "" };
    }
    return {
      valid: false,
      value: null,
      error: "Must be a JSON array of strings, e.g. [\"a\",\"b\"].",
    };
  } catch {
    return { valid: false, value: null, error: "Invalid JSON." };
  }
}

/**
 * Editable audit-results arrays (DB-only), rendered inside Step 2.
 *
 * Shows four textareas populated from the loader's DB-authoritative config.
 * Each box validates as a JSON array of strings. A compact Save button appears
 * beside the toggle when that box is dirty and valid. Invalid JSON replaces
 * the hint and tints the card critical. Invalid content is never saved.
 */
export default function Step3Titles({ config }) {
  const fetcher = useFetcher();
  const saveData = fetcher.data;

  // drafts[key] = current editable text; originals[key] = last-saved text.
  const [drafts, setDrafts] = useState({});
  const [originals, setOriginals] = useState({});
  const [errors, setErrors] = useState({});

  // Delay drafts: stores user input in SECONDS (display unit)
  const [delayDrafts, setDelayDrafts] = useState({});
  const [delayOriginals, setDelayOriginals] = useState({});

  // Local toggle ON/OFF per field. Initialized from the loader config and
  // updated optimistically from the toggle fetcher response.
  const [toggles, setToggles] = useState({});
  const [savingKey, setSavingKey] = useState(null);

  useEffect(() => {
    setToggles({
      auditDeferArray: config?.auditDeferArrayEnabled ?? true,
      auditHideSelectors: config?.auditHideSelectorsEnabled ?? true,
      staticDeferDefaults: config?.staticDeferDefaultsEnabled ?? true,
      firstUserDelayScripts: config?.firstUserDelayScriptsEnabled ?? true,
    });
  }, [config]);

  // Reflect the latest toggle-audit-field fetcher result locally.
  useEffect(() => {
    if (!fetcher.data?.ok || !fetcher.data?.field) return;
    setToggles((prev) => ({
      ...prev,
      [fetcher.data.field]: fetcher.data.enabled,
    }));
  }, [fetcher.data]);

  // Initialize delay values from config
  useEffect(() => {
    const nextDelayDrafts = {};
    const nextDelayOriginals = {};
    FIELDS.forEach(({ delayKey, delayDefault }) => {
      if (delayKey) {
        // Convert milliseconds to seconds for display
        const ms = config?.[delayKey] ?? delayDefault;
        const seconds = Math.floor(ms / 1000);
        nextDelayDrafts[delayKey] = seconds;
        nextDelayOriginals[delayKey] = seconds;
      }
    });
    setDelayDrafts(nextDelayDrafts);
    setDelayOriginals(nextDelayOriginals);
  }, [config]);

  const handleDelayChange = (delayKey, value) => {
    // Only allow positive integers
    const num = parseInt(value, 10);
    if (value === "" || (!isNaN(num) && num >= 0)) {
      setDelayDrafts((prev) => ({ ...prev, [delayKey]: value === "" ? "" : num }));
    }
  };

  const isDelayDirty = (delayKey) => {
    return delayDrafts[delayKey] !== delayOriginals[delayKey];
  };

  // Update delay originals after successful save
  useEffect(() => {
    if (!saveData?.ok) return;

    const nextDelayOriginals = { ...delayOriginals };
    let changed = false;

    FIELDS.forEach(({ delayKey }) => {
      if (delayKey && saveData[delayKey] !== undefined) {
        const seconds = Math.floor(saveData[delayKey] / 1000);
        nextDelayOriginals[delayKey] = seconds;
        setDelayDrafts((prev) => ({ ...prev, [delayKey]: seconds }));
        changed = true;
      }
    });

    if (changed) {
      setDelayOriginals(nextDelayOriginals);
    }
  }, [saveData, delayOriginals]);

  const isEnabled = (field) => toggles[field.key] ?? config?.[field.enabledKey] ?? true;

  const handleToggle = (field, checked) => {
    fetcher.submit(
      {
        intent: "toggle-audit-field",
        field: field.key,
        enabled: String(checked),
      },
      { method: "POST" },
    );
  };

  // (Re)derive drafts + originals from the config whenever it arrives or
  // changes (initial loader data or a completed save).
  useEffect(() => {
    const nextDrafts = {};
    const nextOriginals = {};
    FIELDS.forEach(({ key }) => {
      const text = toEditable(config?.[key] ?? []);
      nextDrafts[key] = text;
      nextOriginals[key] = text;
    });
    setDrafts(nextDrafts);
    setOriginals(nextOriginals);
    setErrors({});
  }, [config]);

  const handleChange = (key, text) => {
    setDrafts((prev) => ({ ...prev, [key]: text }));
    const { valid, error } = validateArray(text);
    setErrors((prev) => ({ ...prev, [key]: valid ? "" : error }));
  };

  const handleSave = (field) => {
    const text = drafts[field.key] ?? "";
    const { valid } = validateArray(text);
    if (!valid) return;

    const payload = { intent: "save-audit-arrays" };
    const original = originals[field.key] ?? text;
    if (text !== original) {
      payload[field.key] = text;
    }

    if (field.delayKey && isDelayDirty(field.delayKey)) {
      const seconds = delayDrafts[field.delayKey];
      if (seconds === "" || Number(seconds) < 0) return;
      payload[field.delayKey] = String(Number(seconds) * 1000);
    }

    if (Object.keys(payload).length === 1) return;

    setSavingKey(field.key);
    fetcher.submit(payload, { method: "POST" });
    setErrors((prev) => ({ ...prev, [field.key]: "" }));
  };

  // Reflect a successful save into the local originals so the box stops being
  // dirty and future diffs are against the freshly stored value.
  useEffect(() => {
    if (!saveData?.ok) return;
    const nextOriginals = { ...originals };
    const nextDrafts = { ...drafts };
    let changed = false;
    FIELDS.forEach(({ key }) => {
      if (saveData[key] !== undefined) {
        const text = toEditable(saveData[key]);
        nextOriginals[key] = text;
        nextDrafts[key] = text;
        changed = true;
      }
    });
    if (changed) {
      setOriginals(nextOriginals);
      setDrafts(nextDrafts);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveData]);

  useEffect(() => {
    if (fetcher.state === "idle") setSavingKey(null);
  }, [fetcher.state]);

  const renderFieldCard = (field) => {
    const enabled = isEnabled(field);
    const draft = drafts[field.key] ?? toEditable(config?.[field.key] ?? []);
    const original = originals[field.key] ?? draft;
    const { valid } = validateArray(draft);
    const dirty = draft !== original;
    const delayDirty = Boolean(field.delayKey && isDelayDirty(field.delayKey));
    const hasJsonError = enabled && !valid;
    const showSave = enabled && valid && (dirty || delayDirty);
    const isSaving = savingKey === field.key && fetcher.state !== "idle";

    return (
      <div
        key={field.key}
        className={`pp-audit-card${hasJsonError ? " is-error" : ""}`}
        style={{
          padding: 12,
          borderRadius: 8,
          display: "flex",
          flexDirection: "column",
          gap: 8,
          minWidth: 0,
          background: hasJsonError
            ? "var(--t-surface-critical-26021, rgba(254, 232, 235, 1))"
            : "transparent",
          border: hasJsonError
            ? "1px solid rgba(142, 11, 33, 0.28)"
            : "1px solid #E5E8EC",
          boxShadow: hasJsonError
            ? "inset 0 0 0 1px rgba(142, 11, 33, 0.06)"
            : "none",
          transition:
            "background-color 240ms ease, border-color 240ms ease, box-shadow 240ms ease",
        }}
      >
        <div className="pp-audit-card__header">
          <div className="pp-audit-card__title">{field.label}</div>
          <div className="pp-audit-card__actions">
            <div
              className={`pp-audit-save${showSave ? " is-visible" : ""}`}
              aria-hidden={!showSave}
              style={{
                display: "flex",
                alignItems: "center",
                maxWidth: showSave ? 120 : 0,
                opacity: showSave ? 1 : 0,
                transform: showSave ? "translateX(0)" : "translateX(8px)",
                overflow: "hidden",
                whiteSpace: "nowrap",
                pointerEvents: showSave ? "auto" : "none",
                transition:
                  "max-width 240ms cubic-bezier(0.22, 1, 0.36, 1), opacity 180ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1)",
              }}
            >
              <s-button
                variant="secondary"
                size="small"
                disabled={!showSave || isSaving}
                onClick={() => handleSave(field)}
              >
                {isSaving ? "Saving…" : "Save"}
              </s-button>
            </div>
            <s-switch
              label=""
              checked={enabled}
              onChange={(e) => handleToggle(field, e.target.checked)}
            />
          </div>
        </div>

        {field.delayKey && (
          <div className="pp-audit-delay">
            <span className="pp-audit-delay__label">Delay Seconds</span>
            <input
              type="number"
              min="0"
              step="1"
              value={
                delayDrafts[field.delayKey] ??
                Math.floor(
                  (config?.[field.delayKey] ?? field.delayDefault) / 1000,
                )
              }
              onChange={(e) =>
                handleDelayChange(field.delayKey, e.target.value)
              }
              disabled={!enabled}
              className="pp-audit-delay__input"
            />
          </div>
        )}

        <div
          className="pp-audit-hint"
          aria-live="polite"
          style={{ position: "relative", minHeight: "1.45em" }}
        >
          <span
            className={`pp-audit-hint__line${hasJsonError ? " is-hidden" : ""}`}
            style={{
              display: "block",
              fontSize: 13,
              lineHeight: 1.45,
              color: "#6B7177",
              opacity: hasJsonError ? 0 : 1,
              position: hasJsonError ? "absolute" : "static",
              inset: hasJsonError ? 0 : undefined,
              pointerEvents: hasJsonError ? "none" : "auto",
              transition: "opacity 180ms ease, color 180ms ease",
            }}
          >
            {field.hint}
          </span>
          <span
            className={`pp-audit-hint__line is-error${
              hasJsonError ? "" : " is-hidden"
            }`}
            style={{
              display: "block",
              fontSize: 13,
              lineHeight: 1.45,
              fontWeight: 500,
              color: "rgb(142, 11, 33)",
              opacity: hasJsonError ? 1 : 0,
              position: hasJsonError ? "static" : "absolute",
              inset: hasJsonError ? undefined : 0,
              pointerEvents: hasJsonError ? "auto" : "none",
              transition: "opacity 180ms ease, color 180ms ease",
            }}
          >
            Invalid JSON
          </span>
        </div>

        {enabled ? (
          <div>
            <s-text-area
              label=""
              value={draft}
              rows={6}
              placeholder={field.placeholder}
              onInput={(e) => handleChange(field.key, e.target.value)}
              onChange={(e) => handleChange(field.key, e.target.value)}
            />
          </div>
        ) : (
          <s-banner tone="info">
            {field.label} is disabled. Its stored value is preserved and will be
            restored when you toggle it on.
          </s-banner>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{`
        .pp-audit-card {
          padding: 12px;
          border: 1px solid #E5E8EC;
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
          background: transparent;
          transition:
            background-color 240ms ease,
            border-color 240ms ease,
            box-shadow 240ms ease;
        }
        .pp-audit-card.is-error {
          background: var(--t-surface-critical-26021, rgba(254, 232, 235, 1));
          border-color: rgba(142, 11, 33, 0.28);
          box-shadow: inset 0 0 0 1px rgba(142, 11, 33, 0.06);
        }
        .pp-audit-card__header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }
        .pp-audit-card__title {
          font-size: 15px;
          font-weight: 700;
          color: #222222;
          min-width: 0;
        }
        .pp-audit-card__actions {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .pp-audit-save {
          display: flex;
          align-items: center;
          max-width: 0;
          opacity: 0;
          transform: translateX(8px);
          overflow: hidden;
          pointer-events: none;
          transition:
            max-width 240ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 180ms ease,
            transform 240ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .pp-audit-save.is-visible {
          max-width: 120px;
          opacity: 1;
          transform: translateX(0);
          pointer-events: auto;
        }
        .pp-audit-delay {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .pp-audit-delay__label {
          font-size: 13px;
          color: #666666;
        }
        .pp-audit-delay__input {
          width: 60px;
          padding: 4px 8px;
          border: 1px solid #cccccc;
          border-radius: 4px;
          font-size: 14px;
          background: #ffffff;
          transition: border-color 180ms ease, box-shadow 180ms ease;
        }
        .pp-audit-delay__input:focus {
          outline: none;
          border-color: #8A8A8A;
          box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.06);
        }
        .pp-audit-delay__input:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .pp-audit-hint {
          position: relative;
          min-height: 1.45em;
        }
        .pp-audit-hint__line {
          display: block;
          font-size: 13px;
          line-height: 1.45;
          color: #6B7177;
          transition: opacity 180ms ease, color 180ms ease;
        }
        .pp-audit-hint__line.is-error {
          color: rgb(142, 11, 33);
          font-weight: 500;
        }
        .pp-audit-hint__line.is-hidden {
          position: absolute;
          inset: 0;
          opacity: 0;
          pointer-events: none;
        }
        .pp-audit-fields {
          margin-top: 20px;
        }
        .pp-audit-grid + .pp-audit-grid {
          margin-top: 16px;
        }
      `}</style>
      <div className="pp-audit-fields">
        <s-text tone="subdued" style={{ marginTop: 0, marginBottom: 16 }}>
          These arrays feed your storefront optimization. Toggle a field off to
          stop using it — its data is preserved and restored when re-enabled.
        </s-text>

        {saveData && !saveData.ok && (
          <s-banner tone="critical" style={{ marginBottom: 16 }}>
            Save failed: {saveData.error || "Unknown error"}
          </s-banner>
        )}

        <div
          className="pp-audit-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 16,
          }}
        >
          {FIELDS.slice(0, 2).map(renderFieldCard)}
        </div>
        <div
          className="pp-audit-grid"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 16,
            marginTop: 16,
          }}
        >
          {FIELDS.slice(2).map(renderFieldCard)}
        </div>
      </div>
    </>
  );
}
