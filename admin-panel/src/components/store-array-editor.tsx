"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AUDIT_ARRAY_FIELDS,
  configArrayForDisplay,
  toEditableArray,
  validateArrayJson,
  type AuditArrayFieldKey,
} from "@/lib/audit-array-fields";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type StoreConfigSlice = Record<string, unknown> & {
  firstUserDelayMs?: number;
  everyTimeDelayMs?: number;
  lastAuditAt?: string | Date | null;
};

function readEnabled(
  config: StoreConfigSlice | null,
  enabledKey: string,
): boolean {
  if (!config) return true;
  const v = config[enabledKey as keyof StoreConfigSlice];
  return v !== false;
}

export default function StoreArrayEditor({
  shopDomain,
  config,
  readOnly = false,
}: {
  shopDomain: string;
  config: StoreConfigSlice | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [originals, setOriginals] = useState<Record<string, string>>({});
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [delayDrafts, setDelayDrafts] = useState<Record<string, number | "">>({});
  const [delayOriginals, setDelayOriginals] = useState<Record<string, number | "">>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const apiBase = `/api/stores/${encodeURIComponent(shopDomain)}/store-config`;

  const syncFromConfig = useCallback(() => {
    const nextDrafts: Record<string, string> = {};
    const nextOriginals: Record<string, string> = {};
    const nextToggles: Record<string, boolean> = {};
    const nextDelayDrafts: Record<string, number | ""> = {};
    const nextDelayOriginals: Record<string, number | ""> = {};

    AUDIT_ARRAY_FIELDS.forEach((field) => {
      const enabled = readEnabled(config, field.enabledKey);
      let values = configArrayForDisplay(config, field.key, field.enabledKey);
      if (enabled && values.length === 0) {
        if (field.key === "firstUserDelayScripts" || field.key === "staticDeferDefaults") {
          values = ["wpm", "gtm"];
        }
      }
      const text = toEditableArray(values);
      nextDrafts[field.key] = text;
      nextOriginals[field.key] = text;
      nextToggles[field.key] = readEnabled(config, field.enabledKey);
      if (field.delayKey) {
        const ms =
          (config?.[field.delayKey as keyof StoreConfigSlice] as number | undefined) ??
          field.delayDefault;
        const sec = Math.floor(Number(ms) / 1000);
        nextDelayDrafts[field.delayKey] = sec;
        nextDelayOriginals[field.delayKey] = sec;
      }
    });

    setDrafts(nextDrafts);
    setOriginals(nextOriginals);
    setToggles(nextToggles);
    setDelayDrafts(nextDelayDrafts);
    setDelayOriginals(nextDelayOriginals);
  }, [config]);

  useEffect(() => {
    syncFromConfig();
  }, [syncFromConfig]);

  const post = async (payload: Record<string, unknown>) => {
    setError(null);
    setSuccess(null);
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Save failed");
    }
    return data;
  };

  const handleToggle = async (fieldKey: AuditArrayFieldKey, enabled: boolean) => {
    if (readOnly) return;
    setSavingKey(fieldKey);
    try {
      await post({
        intent: "toggle-audit-field",
        field: fieldKey,
        enabled,
      });
      setToggles((prev) => ({ ...prev, [fieldKey]: enabled }));
      setSuccess("Toggle saved — storefront script rebuilt.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setSavingKey(null);
    }
  };

  const handleSave = async (fieldKey: AuditArrayFieldKey) => {
    if (readOnly) return;
    const field = AUDIT_ARRAY_FIELDS.find((f) => f.key === fieldKey);
    if (!field) return;

    const draft = drafts[fieldKey] ?? "";
    const { valid, value } = validateArrayJson(draft);
    if (!valid || !value) {
      setError("Fix JSON before saving.");
      return;
    }

    const patch: Record<string, unknown> = { [fieldKey]: value };

    if (field.delayKey) {
      const sec = delayDrafts[field.delayKey];
      if (sec === "" || Number(sec) < 0) {
        setError("Enter a valid delay in seconds.");
        return;
      }
      if (sec !== delayOriginals[field.delayKey]) {
        patch[field.delayKey] = Number(sec) * 1000;
      }
    }

    const original = originals[fieldKey] ?? "";
    const dirtyJson = draft !== original;
    const delayDirty =
      field.delayKey &&
      delayDrafts[field.delayKey] !== delayOriginals[field.delayKey];
    if (!dirtyJson && !delayDirty) return;

    setSavingKey(fieldKey);
    try {
      await post({
        intent: "save-audit-arrays",
        patch,
      });
      setOriginals((prev) => ({ ...prev, [fieldKey]: draft }));
      if (field.delayKey) {
        setDelayOriginals((prev) => ({
          ...prev,
          [field.delayKey!]: delayDrafts[field.delayKey!] ?? "",
        }));
      }
      setSuccess("Saved — storefront script rebuilt for this store.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSavingKey(null);
    }
  };

  const renderCard = (field: (typeof AUDIT_ARRAY_FIELDS)[number]) => {
    const enabled = toggles[field.key] ?? readEnabled(config, field.enabledKey);
    const draft = drafts[field.key] ?? toEditableArray(config?.[field.key as keyof StoreConfigSlice]);
    const original = originals[field.key] ?? draft;
    const { valid } = validateArrayJson(draft);
    const dirty = draft !== original;
    const delayDirty =
      field.delayKey &&
      delayDrafts[field.delayKey] !== delayOriginals[field.delayKey];
    const hasJsonError = enabled && !valid;
    const showSave = enabled && valid && (dirty || delayDirty);
    const isSaving = savingKey === field.key;

    return (
      <div
        key={field.key}
        className={cn(
          "rounded-lg border p-4 flex flex-col gap-3 min-w-0",
          hasJsonError && "border-destructive/50 bg-destructive/5",
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold">{field.label}</h3>
          <div className="flex items-center gap-2 shrink-0">
            {showSave && !readOnly && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isSaving}
                onClick={() => handleSave(field.key)}
              >
                {isSaving ? "Saving…" : "Save"}
              </Button>
            )}
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={enabled}
                disabled={readOnly || isSaving}
                onChange={(e) => handleToggle(field.key, e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              On
            </label>
          </div>
        </div>

        {field.delayKey && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">Delay (seconds)</span>
            <input
              type="number"
              min={0}
              step={1}
              disabled={!enabled || readOnly}
              className="w-20 rounded-md border border-input bg-background px-2 py-1 text-sm"
              value={delayDrafts[field.delayKey] ?? ""}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === "") {
                  setDelayDrafts((p) => ({ ...p, [field.delayKey!]: "" }));
                  return;
                }
                const n = parseInt(raw, 10);
                if (!Number.isNaN(n) && n >= 0) {
                  setDelayDrafts((p) => ({ ...p, [field.delayKey!]: n }));
                }
              }}
            />
          </div>
        )}

        <p className={cn("text-xs", hasJsonError ? "text-destructive font-medium" : "text-muted-foreground")}>
          {hasJsonError ? "Invalid JSON" : field.hint}
        </p>

        {!enabled && (
          <p className="text-xs text-muted-foreground">
            Toggle off — storefront receives an empty list; preserved values below restore
            when you turn this on again.
          </p>
        )}
        <textarea
          rows={8}
          disabled={readOnly || !enabled}
          readOnly={!enabled}
          className={cn(
            "font-mono text-xs w-full rounded-md border border-input p-3 resize-y min-h-[120px]",
            enabled ? "bg-background" : "bg-muted/40 text-muted-foreground",
          )}
          placeholder={field.placeholder}
          value={draft}
          onChange={(e) =>
            setDrafts((prev) => ({ ...prev, [field.key]: e.target.value }))
          }
        />
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Same four array boxes as PagePulse Step 2 (union lists in Postgres). Saving updates
        the DB and rebuilds this store&apos;s injected script. If an audit has run, the
        storefront may also use per-page data from the latest audit — these union fields still
        apply for fallback pages and delays.
      </p>
      {config?.lastAuditAt && (
        <p className="text-xs text-muted-foreground">
          Last audit:{" "}
          {typeof config.lastAuditAt === "string"
            ? new Date(config.lastAuditAt).toLocaleString()
            : config.lastAuditAt instanceof Date
              ? config.lastAuditAt.toLocaleString()
              : "—"}
        </p>
      )}

      {readOnly && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
          Demo mode or missing config — editing is disabled.
        </p>
      )}

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md p-3">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-green-800 bg-green-50 border border-green-200 rounded-md p-3">
          {success}
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {AUDIT_ARRAY_FIELDS.map(renderCard)}
      </div>
    </div>
  );
}
