"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TEMPLATE_SCOPE_LABELS,
  TEMPLATE_SCOPES,
  type TemplateScope,
  auditDeferColumn,
  auditHideColumn,
  everyTimeDelayMsColumn,
  firstUserDelayColumn,
  firstUserDelayMsColumn,
  readBucketsFromRow,
  staticDeferColumn,
  templateConfigFromRow,
  templateDelayFormKeys,
  templateListFormKeys,
  unionTemplateLists,
} from "@/lib/template-script-config";
import { readJsonStringArray, validateArrayJson } from "@/lib/audit-array-fields";
import { Button } from "@/components/ui/button";
import { cn, formatDate } from "@/lib/utils";
import type { AuditSummary } from "@/lib/types";

const LIST_BLOCKS = [
  {
    label: "Defer heavy scripts",
    columnFn: auditDeferColumn,
    enabledKey: "auditDeferArrayEnabled",
    unionKey: "auditDeferArray",
  },
  {
    label: "Hide selectors",
    columnFn: auditHideColumn,
    enabledKey: "auditHideSelectorsEnabled",
    unionKey: "auditHideSelectors",
  },
  {
    label: "First-visit delay scripts",
    columnFn: firstUserDelayColumn,
    enabledKey: "firstUserDelayScriptsEnabled",
    unionKey: "firstUserDelayScripts",
  },
  {
    label: "Every-load delay scripts",
    columnFn: staticDeferColumn,
    enabledKey: "staticDeferDefaultsEnabled",
    unionKey: "staticDeferDefaults",
  },
] as const;

const MASTER_TOGGLES = LIST_BLOCKS.map((b) => ({
  key: b.enabledKey,
  label: b.label,
}));

function toEditable(value: unknown): string {
  return JSON.stringify(readJsonStringArray(value), null, 2);
}

function rowFromConfig(config: Record<string, unknown> | null): Record<string, unknown> {
  if (!config) return {};
  return { ...config, ...templateConfigFromRow(config) };
}

export default function StoreTemplateEditor({
  shopDomain,
  config,
  auditSummary,
  readOnly = false,
}: {
  shopDomain: string;
  config: Record<string, unknown> | null;
  auditSummary?: AuditSummary | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<TemplateScope>("global");
  const [listDrafts, setListDrafts] = useState<Record<string, string>>({});
  const [delayDrafts, setDelayDrafts] = useState<Record<string, number>>({});
  const [toggles, setToggles] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const apiBase = `/api/stores/${encodeURIComponent(shopDomain)}/store-config`;

  const syncFromConfig = useCallback(() => {
    const row = rowFromConfig(config);
    const lists: Record<string, string> = {};
    for (const key of templateListFormKeys()) {
      lists[key] = toEditable(row[key]);
    }
    const delays: Record<string, number> = {};
    for (const key of templateDelayFormKeys()) {
      const v = row[key];
      delays[key] = typeof v === "number" && !Number.isNaN(v) ? v : key.includes("first") ? 12000 : 6000;
    }
    const t: Record<string, boolean> = {};
    for (const m of MASTER_TOGGLES) {
      t[m.key] = config?.[m.key] !== false;
    }
    setListDrafts(lists);
    setDelayDrafts(delays);
    setToggles(t);
  }, [config]);

  useEffect(() => {
    syncFromConfig();
  }, [syncFromConfig]);

  const unionPreview = useMemo(() => {
    const parsed: Record<string, unknown> = { ...(config || {}) };
    for (const key of templateListFormKeys()) {
      const text = listDrafts[key];
      if (!text) continue;
      const { valid, value } = validateArrayJson(text);
      if (valid && value) parsed[key] = value;
    }
    return {
      auditDeferArray: unionTemplateLists(
        readBucketsFromRow(parsed, auditDeferColumn, "auditDeferArray"),
      ),
      auditHideSelectors: unionTemplateLists(
        readBucketsFromRow(parsed, auditHideColumn, "auditHideSelectors"),
      ),
      firstUserDelayScripts: unionTemplateLists(
        readBucketsFromRow(parsed, firstUserDelayColumn, "firstUserDelayScripts"),
      ),
      staticDeferDefaults: unionTemplateLists(
        readBucketsFromRow(parsed, staticDeferColumn, "staticDeferDefaults"),
      ),
    };
  }, [config, listDrafts]);

  const post = async (payload: Record<string, unknown>) => {
    const res = await fetch(apiBase, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) throw new Error(data.error || "Request failed");
  };

  const handleToggle = async (enabledKey: string, enabled: boolean) => {
    if (readOnly) return;
    const fieldMap: Record<string, string> = {
      auditDeferArrayEnabled: "auditDeferArray",
      auditHideSelectorsEnabled: "auditHideSelectors",
      staticDeferDefaultsEnabled: "staticDeferDefaults",
      firstUserDelayScriptsEnabled: "firstUserDelayScripts",
    };
    setSaving(true);
    setError(null);
    try {
      await post({
        intent: "toggle-audit-field",
        field: fieldMap[enabledKey],
        enabled,
      });
      setToggles((p) => ({ ...p, [enabledKey]: enabled }));
      setSuccess("Toggle saved — script rebuilt.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Toggle failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAll = async () => {
    if (readOnly) return;
    setError(null);
    setSuccess(null);

    const patch: Record<string, unknown> = {};
    for (const key of templateListFormKeys()) {
      const text = listDrafts[key] ?? "[]";
      const { valid, value } = validateArrayJson(text);
      if (!valid || !value) {
        setError(`Invalid JSON in ${key}`);
        return;
      }
      patch[key] = value;
    }
    for (const key of templateDelayFormKeys()) {
      const ms = delayDrafts[key];
      if (ms === undefined || ms < 0) {
        setError(`Invalid delay for ${key}`);
        return;
      }
      patch[key] = ms;
    }
    patch.firstUserDelayMs = delayDrafts.firstUserDelayMsGlobal ?? 12000;
    patch.everyTimeDelayMs = delayDrafts.everyTimeDelayMsGlobal ?? 6000;

    setSaving(true);
    try {
      await post({ intent: "save-audit-arrays", patch });
      setSuccess("All template lists saved — storefront script rebuilt.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const listEnabled = (enabledKey: string) => toggles[enabledKey] ?? true;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Same template lists as PagePulse (Global / Home / Collection / Product). Saving
        writes every scope column, recomputes union fields, and rebuilds the inject script.
      </p>

      {auditSummary && (
        <div className="text-sm rounded-md border border-border bg-muted/30 p-3 space-y-1">
          <p className="font-medium">Latest completed audit</p>
          <p className="text-muted-foreground">
            {formatDate(auditSummary.completedAt)}
            {auditSummary.variantCount != null &&
              ` · ${auditSummary.variantCount} page pattern(s)`}
            {auditSummary.baseCount != null &&
              ` · ${auditSummary.baseCount} base script(s)`}
          </p>
          <p className="text-xs text-muted-foreground">
            Per-page variant data from the audit can still gate scripts on specific templates.
            Editing lists here updates DB template columns and union fallbacks.
          </p>
        </div>
      )}

      {config?.appEnabled === false && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md p-3">
          App is off for this store — rebuild will ship an empty inject script until the merchant
          turns the app on.
        </p>
      )}

      {readOnly && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
          Demo mode or missing config — editing is disabled.
        </p>
      )}

      <div className="flex flex-wrap gap-4 items-center border-b border-border pb-3">
        {MASTER_TOGGLES.map((t) => (
          <label key={t.key} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={listEnabled(t.key)}
              disabled={readOnly || saving}
              onChange={(e) => handleToggle(t.key, e.target.checked)}
            />
            {t.label}
          </label>
        ))}
      </div>

      <div className="flex gap-1 border-b border-border">
        {TEMPLATE_SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              "px-3 py-2 text-sm font-medium border-b-2 -mb-px",
              scope === s
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground",
            )}
          >
            {TEMPLATE_SCOPE_LABELS[s]}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {LIST_BLOCKS.map((block) => {
          const col = block.columnFn(scope);
          const draft = listDrafts[col] ?? "[]";
          const enabled = listEnabled(block.enabledKey);
          const { valid } = validateArrayJson(draft);
          return (
            <div
              key={col}
              className={cn(
                "rounded-lg border p-3 flex flex-col gap-2",
                enabled && !valid && "border-destructive/50",
              )}
            >
              <div className="text-sm font-semibold">{block.label}</div>
              <textarea
                rows={6}
                disabled={readOnly || !enabled}
                className="font-mono text-xs w-full rounded-md border p-2 min-h-[100px]"
                value={draft}
                onChange={(e) =>
                  setListDrafts((p) => ({ ...p, [col]: e.target.value }))
                }
              />
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap gap-6 text-sm">
        <label className="flex items-center gap-2">
          First-visit delay (ms)
          <input
            type="number"
            min={0}
            disabled={readOnly || !listEnabled("firstUserDelayScriptsEnabled")}
            className="w-24 border rounded px-2 py-1"
            value={delayDrafts[firstUserDelayMsColumn(scope)] ?? 12000}
            onChange={(e) =>
              setDelayDrafts((p) => ({
                ...p,
                [firstUserDelayMsColumn(scope)]: Number(e.target.value) || 0,
              }))
            }
          />
        </label>
        <label className="flex items-center gap-2">
          Every-load delay (ms)
          <input
            type="number"
            min={0}
            disabled={readOnly || !listEnabled("staticDeferDefaultsEnabled")}
            className="w-24 border rounded px-2 py-1"
            value={delayDrafts[everyTimeDelayMsColumn(scope)] ?? 6000}
            onChange={(e) =>
              setDelayDrafts((p) => ({
                ...p,
                [everyTimeDelayMsColumn(scope)]: Number(e.target.value) || 0,
              }))
            }
          />
        </label>
      </div>

      {!readOnly && (
        <Button type="button" disabled={saving} onClick={handleSaveAll}>
          {saving ? "Saving…" : "Save all scopes & rebuild script"}
        </Button>
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

      <div className="rounded-lg border p-4 space-y-2">
        <p className="text-sm font-semibold">Computed unions (storefront fallback)</p>
        {LIST_BLOCKS.map((b) => (
          <UnionLine
            key={b.unionKey}
            label={b.label}
            items={unionPreview[b.unionKey as keyof typeof unionPreview]}
          />
        ))}
      </div>
    </div>
  );
}

function UnionLine({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="text-xs">
      <span className="text-muted-foreground">{label}: </span>
      {items.length === 0 ? (
        <span className="italic">empty</span>
      ) : (
        <span className="font-mono">{items.join(", ")}</span>
      )}
    </div>
  );
}
