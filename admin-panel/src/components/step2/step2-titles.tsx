"use client";

import { useEffect, useRef, useState } from "react";
import {
  fieldsForScope,
  toEditable,
  validateArray,
  type Step2FieldDef,
} from "@/lib/step2-field-helpers";
import type { TemplateScope } from "@/lib/storefront-lists";
import { PpBanner, PpButton, PpSwitch, PpTextArea } from "@/components/pp/polaris-shims";

export type SaveBoxPayload = {
  scope: TemplateScope;
  family: Step2FieldDef["listFamily"];
  list?: string[];
  firstMs?: number;
  everyMs?: number;
};

export default function Step2Titles({
  config,
  scope,
  readOnly,
  savingKey,
  saveError,
  metafieldWarning,
  onToggle,
  onSave,
}: {
  config: Record<string, unknown>;
  scope: TemplateScope;
  readOnly?: boolean;
  savingKey: string | null;
  saveError: string | null;
  metafieldWarning: boolean;
  onToggle: (toggleField: string, enabled: boolean) => void;
  onSave: (payload: SaveBoxPayload) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [delayDrafts, setDelayDrafts] = useState<Record<string, string | number>>({});
  const [delayOriginals, setDelayOriginals] = useState<Record<string, string | number>>({});
  const [toggles, setToggles] = useState<Record<string, boolean>>({});

  const prevScopeRef = useRef(scope);
  const draftsRef = useRef(drafts);
  const originalsRef = useRef(originals);
  const delayDraftsRef = useRef(delayDrafts);
  const delayOriginalsRef = useRef(delayOriginals);
  const priorOriginalsRef = useRef<Record<string, string>>({});
  const [externalChangeNotice, setExternalChangeNotice] = useState(false);

  useEffect(() => {
    draftsRef.current = drafts;
  }, [drafts]);
  useEffect(() => {
    originalsRef.current = originals;
  }, [originals]);
  useEffect(() => {
    delayDraftsRef.current = delayDrafts;
  }, [delayDrafts]);
  useEffect(() => {
    delayOriginalsRef.current = delayOriginals;
  }, [delayOriginals]);

  useEffect(() => {
    setToggles({
      auditDeferArray: config.auditDeferArrayEnabled !== false,
      auditHideSelectors: config.auditHideSelectorsEnabled !== false,
      staticDeferDefaults: config.staticDeferDefaultsEnabled !== false,
      firstUserDelayScripts: config.firstUserDelayScriptsEnabled !== false,
    });
  }, [config]);

  useEffect(() => {
    const FIELDS = fieldsForScope(scope);
    const scopeChanged = prevScopeRef.current !== scope;
    prevScopeRef.current = scope;

    const prevListDrafts = draftsRef.current;
    const prevListOriginals = originalsRef.current;
    const nextListOriginals = { ...prevListOriginals };
    const nextListDrafts = { ...prevListDrafts };

    let external = false;
    FIELDS.forEach(({ key }) => {
      const text = toEditable(config[key] ?? []);
      nextListOriginals[key] = text;
      const dirty =
        !scopeChanged && prevListDrafts[key] !== prevListOriginals[key];
      if (
        !scopeChanged &&
        dirty &&
        text !== prevListOriginals[key]
      ) {
        external = true;
      }
      if (!dirty) nextListDrafts[key] = text;
    });
    if (external) setExternalChangeNotice(true);
    priorOriginalsRef.current = { ...prevListOriginals };
    setOriginals(nextListOriginals);
    setDrafts(nextListDrafts);

    const prevDelayDrafts = delayDraftsRef.current;
    const prevDelayOriginals = delayOriginalsRef.current;
    const nextDelayOriginals = { ...prevDelayOriginals };
    const nextDelayDrafts = { ...prevDelayDrafts };
    FIELDS.forEach(({ delayKey, delayDefault }) => {
      if (!delayKey) return;
      const ms = (config[delayKey] as number | undefined) ?? delayDefault ?? 0;
      const seconds = Math.floor(ms / 1000);
      nextDelayOriginals[delayKey] = seconds;
      const dirty =
        !scopeChanged &&
        prevDelayDrafts[delayKey] !== prevDelayOriginals[delayKey];
      if (!dirty) nextDelayDrafts[delayKey] = seconds;
    });
    setDelayOriginals(nextDelayOriginals);
    setDelayDrafts(nextDelayDrafts);
  }, [config, scope]);

  const handleDelayChange = (delayKey: string, value: string) => {
    const num = parseInt(value, 10);
    if (value === "" || (!Number.isNaN(num) && num >= 0)) {
      setDelayDrafts((prev) => ({
        ...prev,
        [delayKey]: value === "" ? "" : num,
      }));
    }
  };

  const isDelayDirty = (delayKey: string) =>
    delayDrafts[delayKey] !== delayOriginals[delayKey];

  const isEnabled = (field: Step2FieldDef) =>
    toggles[field.toggleField] ?? config[field.enabledKey] !== false;

  const handleSave = (field: Step2FieldDef) => {
    const text = drafts[field.key] ?? "";
    const { valid, value } = validateArray(text);
    if (!valid || !value) return;

    const original = originals[field.key] ?? text;
    const listDirty = text !== original;
    const delayDirty = Boolean(field.delayKey && isDelayDirty(field.delayKey));
    if (!listDirty && !delayDirty) return;

    const payload: SaveBoxPayload = { scope, family: field.listFamily };
    if (listDirty) payload.list = value;
    if (field.delayKey && delayDirty) {
      const seconds = delayDrafts[field.delayKey];
      if (seconds === "" || Number(seconds) < 0) return;
      const ms = Math.round(Number(seconds) * 1000);
      if (field.listFamily === "first") payload.firstMs = ms;
      if (field.listFamily === "every") payload.everyMs = ms;
    }
    if (!payload.list && payload.firstMs == null && payload.everyMs == null) return;
    onSave(payload);
  };

  const FIELDS = fieldsForScope(scope);

  const renderFieldCard = (field: Step2FieldDef) => {
    const enabled = isEnabled(field);
    const draft = drafts[field.key] ?? toEditable(config[field.key] ?? []);
    const original = originals[field.key] ?? draft;
    const { valid } = validateArray(draft);
    const dirty = draft !== original;
    const delayDirty = Boolean(field.delayKey && isDelayDirty(field.delayKey));
    const hasJsonError = enabled && !valid;
    const showSave = enabled && valid && (dirty || delayDirty);
    const isSaving = savingKey === field.key;

    return (
      <div
        key={field.key}
        className={`pp-audit-card${hasJsonError ? " is-error" : ""}`}
      >
        <div className="pp-audit-card__header">
          <div className="pp-audit-card__title">{field.label}</div>
          <div className="pp-audit-card__actions">
            <div
              className={`pp-audit-save${showSave ? " is-visible" : ""}`}
              aria-hidden={!showSave}
            >
              <PpButton
                disabled={!showSave || isSaving || readOnly}
                onClick={() => handleSave(field)}
              >
                {isSaving ? "Saving…" : "Save"}
              </PpButton>
            </div>
            <PpSwitch
              checked={enabled}
              disabled={readOnly || isSaving}
              onChange={(checked) => {
                setToggles((p) => ({ ...p, [field.toggleField]: checked }));
                onToggle(field.toggleField, checked);
              }}
            />
          </div>
        </div>

        {field.delayKey && (
          <div className="pp-audit-delay">
            <span className="pp-audit-delay__label">Delay Seconds</span>
            <input
              type="number"
              min={0}
              step={1}
              className="pp-audit-delay__input"
              value={
                delayDrafts[field.delayKey] ??
                Math.floor(
                  ((config[field.delayKey] as number) ?? field.delayDefault ?? 0) /
                    1000,
                )
              }
              onChange={(e) => handleDelayChange(field.delayKey!, e.target.value)}
              disabled={!enabled || readOnly}
            />
          </div>
        )}

        <div className="pp-audit-hint" aria-live="polite">
          <span
            className={`pp-audit-hint__line${hasJsonError ? " is-hidden" : ""}`}
            aria-hidden={hasJsonError}
          >
            {field.hint}
          </span>
          <span
            className={`pp-audit-hint__line is-error${hasJsonError ? "" : " is-hidden"}`}
            aria-hidden={!hasJsonError}
          >
            {validateArray(draft).error || "Invalid list format"}
          </span>
        </div>

        {enabled ? (
          <PpTextArea
            value={draft}
            placeholder={field.placeholder}
            disabled={readOnly || isSaving}
            onChange={(v) => setDrafts((p) => ({ ...p, [field.key]: v }))}
          />
        ) : (
          <PpBanner tone="info">
            {field.label} is disabled. Its stored value is preserved and will be
            restored when you toggle it on.
          </PpBanner>
        )}
      </div>
    );
  };

  return (
    <div className="pp-audit-fields">
      {externalChangeNotice && (
        <PpBanner tone="info">
          This list was changed elsewhere. Your unsaved edit is kept.
        </PpBanner>
      )}
      {saveError && (
        <PpBanner tone="critical">Save failed: {saveError}</PpBanner>
      )}
      {metafieldWarning && (
        <PpBanner tone="warning">
          Saved in the database. The shop is still running the previous script
          because the metafield update failed.
        </PpBanner>
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
  );
}
