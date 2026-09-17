/* eslint-disable react/prop-types */
import { useState, useEffect } from "react";
import { useFetcher } from "react-router";

const FIELDS = [
  {
    key: "auditDeferArray",
    enabledKey: "auditDeferArrayEnabled",
    preservedKey: "auditDeferArrayPreserved",
    label: "Defer Heavy Scripts",
    hint: "Scripts/patterns found by the audit to defer loading.",
    placeholder: '["jquery.min.js","cdn.clarity"]',
  },
  {
    key: "auditHideSelectors",
    enabledKey: "auditHideSelectorsEnabled",
    preservedKey: "auditHideSelectorsPreserved",
    label: "Hide Lastfold Classes",
    hint: "CSS selectors for off-screen sections found by the audit.",
    placeholder: '["#footer-links",".product-grid > :nth-child(n+5)"]',
  },
  {
    key: "staticDeferDefaults",
    enabledKey: "staticDeferDefaultsEnabled",
    preservedKey: "staticDeferDefaultsPreserved",
    label: "Delay Scripts",
    hint: "Always-deferred defaults, independent of the audit.",
    placeholder: '["wpm","gtm","clarity"]',
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
 * Shows three textareas (defer array, hide selectors, static defer defaults)
 * populated from the loader's DB-authoritative config. Each box validates its
 * content as a strict JSON array of strings, and a Save button appears only
 * when the content is valid and has changed. Saving writes just that field to
 * the DB (not the metaobject). Invalid content is never saved.
 */
export default function Step3Titles({ config }) {
  const fetcher = useFetcher();

  // drafts[key] = current editable text; originals[key] = last-saved text.
  const [drafts, setDrafts] = useState({});
  const [originals, setOriginals] = useState({});
  const [errors, setErrors] = useState({});

  // Local toggle ON/OFF per field. Initialized from the loader config and
  // updated optimistically from the toggle fetcher response.
  const [toggles, setToggles] = useState({});

  useEffect(() => {
    setToggles({
      auditDeferArray: config?.auditDeferArrayEnabled ?? true,
      auditHideSelectors: config?.auditHideSelectorsEnabled ?? true,
      staticDeferDefaults: config?.staticDeferDefaultsEnabled ?? true,
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
    const text = drafts[field.key];
    const { valid } = validateArray(text);
    if (!valid) return;

    fetcher.submit(
      {
        intent: "save-audit-arrays",
        [field.key]: text,
      },
      { method: "POST" },
    );

    // Optimistically mark this box saved; on failure the fetcher error below
    // will surface and the user can retry. Original only updates on success.
    setErrors((prev) => ({ ...prev, [field.key]: "" }));
  };

  // Reflect a successful save into the local originals so the box stops being
  // dirty and future diffs are against the freshly stored value.
  const saveData = fetcher.data;
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

  return (
    <s-section heading="">
      <s-stack direction="block" gap="loose">
        <s-text tone="subdued">
          These arrays feed your storefront optimization. Toggle a field off to
          stop using it — its data is preserved and restored when re-enabled.
        </s-text>

        {saveData && !saveData.ok && (
          <s-banner tone="critical">
            Save failed: {saveData.error || "Unknown error"}
          </s-banner>
        )}

        {FIELDS.map((field) => {
          const enabled = isEnabled(field);
          const draft = drafts[field.key] ?? toEditable(config?.[field.key] ?? []);
          const original = originals[field.key] ?? draft;
          const { valid } = validateArray(draft);
          const dirty = draft !== original;

          return (
            <div
              key={field.key}
              style={{ padding: "12px 0", borderBottom: "1px solid #E5E8EC" }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <div
                  style={{ fontSize: 15, fontWeight: 700, color: "#222222" }}
                >
                  {field.label}
                </div>
                <s-switch
                  label=""
                  checked={enabled}
                  onChange={(e) => handleToggle(field, e.target.checked)}
                />
              </div>
              <s-text tone="subdued">{field.hint}</s-text>

              {enabled ? (
                <>
                  <div style={{ marginTop: 8 }}>
                    <s-text-area
                      label=""
                      value={draft}
                      rows={8}
                      placeholder={field.placeholder}
                      onInput={(e) => handleChange(field.key, e.target.value)}
                      onChange={(e) => handleChange(field.key, e.target.value)}
                    />
                  </div>
                  {errors[field.key] && (
                    <div style={{ marginTop: 8 }}>
                      <s-banner tone="critical">{errors[field.key]}</s-banner>
                    </div>
                  )}
                  {dirty && valid && (
                    <div style={{ marginTop: 10 }}>
                      <s-button variant="primary" onClick={() => handleSave(field)}>
                        Save {field.label}
                      </s-button>
                    </div>
                  )}
                  {!dirty && (
                    <div style={{ marginTop: 6 }}>
                      <s-text tone="subdued">Saved</s-text>
                    </div>
                  )}
                </>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <s-banner tone="info">
                    {field.label} is disabled. Its stored value is preserved and
                    will be restored when you toggle it on.
                  </s-banner>
                </div>
              )}
            </div>
          );
        })}
      </s-stack>
    </s-section>
  );
}
