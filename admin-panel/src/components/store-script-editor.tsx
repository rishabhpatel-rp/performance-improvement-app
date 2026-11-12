"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn, formatDate } from "@/lib/utils";
import {
  ENABLED_FIELD,
  SCOPE_META,
  TEMPLATE_SCOPES,
  delaySeconds,
  listToText,
  parseListText,
  readDelayMs,
  readStringList,
  scopeListColumn,
  unionOf,
  type DelayKind,
  type ListFamily,
  type TemplateScope,
} from "@/lib/storefront-lists";
import type {
  AuditSummary,
  ScriptInventorySummary,
  StoreConfig,
} from "@/lib/types";

type Box = {
  family: ListFamily;
  label: string;
  hint: string;
  placeholder: string;
  delay?: DelayKind;
  delayFallbackMs?: number;
};

const BOXES: Box[] = [
  {
    family: "defer",
    label: "Defer heavy scripts",
    hint: "Held until the visitor interacts (click, scroll, key press).",
    placeholder: "jquery.min.js\ncdn.clarity.ms",
  },
  {
    family: "hide",
    label: "Hide below-the-fold selectors",
    hint: "CSS selectors kept hidden until the visitor interacts.",
    placeholder: "#footer-links\n.product-grid > :nth-child(n+5)",
  },
  {
    family: "first",
    label: "Delay for first-time visitors",
    hint: "Delayed only for a visitor's first page in the session.",
    placeholder: "wpm\ngtm",
    delay: "first",
    delayFallbackMs: 12000,
  },
  {
    family: "every",
    label: "Delay on every visit",
    hint: "Delayed on every page load for every visitor.",
    placeholder: "wpm\ngtm",
    delay: "every",
    delayFallbackMs: 6000,
  },
];

const TOKEN_ACTIONS = [
  { value: "defer", label: "Defer until interaction" },
  { value: "delay_first", label: "Delay (first visit)" },
  { value: "delay_every", label: "Delay (every visit)" },
  { value: "protected", label: "Remove from lists" },
] as const;

function scriptsForScope(
  summary: ScriptInventorySummary | null,
  scope: TemplateScope,
) {
  const rows = summary?.topScripts ?? [];
  const roles = summary?.pageRoles ?? {};
  if (scope === "global") {
    const present = [
      ...new Set(
        Object.values(roles).filter((role) =>
          ["home", "collection", "product"].includes(role),
        ),
      ),
    ];
    if (!present.length) return rows;
    return rows.filter((row) => {
      const have = new Set(
        (row.pages || []).map((page) => roles[page]).filter(Boolean),
      );
      return present.every((role) => have.has(role));
    });
  }
  const want = scope;
  return rows.filter((row) =>
    (row.pages || []).some((page) => roles[page] === want),
  );
}

function actionFor(
  token: string,
  lists: { defer: string[]; first: string[]; every: string[] },
): string {
  if (lists.defer.includes(token)) return "defer";
  if (lists.first.includes(token)) return "delay_first";
  if (lists.every.includes(token)) return "delay_every";
  return "protected";
}

export default function StoreScriptEditor({
  domain,
  config,
  appEnabled,
  readableScript,
  hiddenCss,
  scriptBuiltAt,
  metafieldSyncedAt,
  scriptHash,
  summary,
  auditSummary,
  readOnly = false,
}: {
  domain: string;
  config: StoreConfig | null;
  appEnabled: boolean;
  readableScript: string;
  hiddenCss: string;
  scriptBuiltAt: string | null;
  metafieldSyncedAt: string | null;
  scriptHash: string | null;
  summary: ScriptInventorySummary | null;
  auditSummary: AuditSummary | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const cfg = useMemo(
    () => (config ?? {}) as unknown as Record<string, unknown>,
    [config],
  );
  const [scope, setScope] = useState<TemplateScope>("global");
  const [listDrafts, setListDrafts] = useState<Record<string, string>>({});
  const [delayDrafts, setDelayDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [filter, setFilter] = useState("");
  const [copied, setCopied] = useState(false);

  const meta = SCOPE_META[scope];

  const listFor = (family: ListFamily) =>
    readStringList(cfg[scopeListColumn(family, scope)]);

  const draftKey = (family: ListFamily) => `${scope}:${family}`;

  const textFor = (family: ListFamily) =>
    listDrafts[draftKey(family)] ?? listToText(listFor(family));

  const delayKey = (kind: DelayKind) => `${scope}:${kind}`;

  const secondsFor = (box: Box) => {
    if (!box.delay) return "";
    const draft = delayDrafts[delayKey(box.delay)];
    if (draft !== undefined) return draft;
    return String(
      delaySeconds(
        readDelayMs(cfg, box.delay, scope, box.delayFallbackMs ?? 0),
      ),
    );
  };

  const enabledFor = (family: ListFamily) =>
    cfg[ENABLED_FIELD[family]] !== false;

  const globalTokens = useMemo(() => {
    const set = new Set<string>();
    for (const family of ["defer", "first", "every"] as ListFamily[]) {
      unionOf(cfg, family).forEach((token) => set.add(token));
    }
    return set;
  }, [cfg]);

  const currentLists = {
    defer: listFor("defer"),
    first: listFor("first"),
    every: listFor("every"),
  };

  const rows = useMemo(() => {
    const source = scriptsForScope(summary, scope);
    const needle = filter.trim().toLowerCase();
    return needle
      ? source.filter((row) => row.token.toLowerCase().includes(needle))
      : source;
  }, [summary, scope, filter]);

  async function post(body: Record<string, unknown>, key: string) {
    setSaving(key);
    setNotice(null);
    try {
      const res = await fetch(
        `/api/stores/${encodeURIComponent(domain)}/script`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, scope }),
          cache: "no-store",
        },
      );
      const data = (await res.json().catch(() => ({
        ok: false,
        error: "The merchant app did not return JSON.",
      }))) as { ok?: boolean; error?: string; metafieldStatus?: string };
      if (!res.ok || !data.ok) {
        setNotice({
          kind: "error",
          text: data.error || `Save failed (HTTP ${res.status}).`,
        });
        return false;
      }
      const status = data.metafieldStatus;
      setNotice({
        kind: "ok",
        text:
          status === "written" || status === "noop"
            ? "Saved. The storefront script was rebuilt and the metafield was pushed."
            : `Saved in the database. Metafield sync: ${status || "unknown"}.`,
      });
      router.refresh();
      return true;
    } catch (err) {
      setNotice({
        kind: "error",
        text: err instanceof Error ? err.message : "Save failed.",
      });
      return false;
    } finally {
      setSaving(null);
    }
  }

  async function toggleBox(box: Box) {
    const enabled = enabledFor(box.family);
    await post(
      {
        intent: "toggle",
        field: ENABLED_FIELD[box.family],
        enabled: !enabled,
      },
      `toggle:${box.family}`,
    );
  }

  async function saveBox(box: Box) {
    const parsed = parseListText(textFor(box.family));
    if (!parsed.ok) {
      setNotice({ kind: "error", text: parsed.error });
      return;
    }

    const patch: Record<string, unknown> = { [box.family]: parsed.value };
    if (box.delay) {
      const seconds = Number(secondsFor(box));
      if (!Number.isFinite(seconds) || seconds < 0) {
        setNotice({ kind: "error", text: "Delay must be zero or greater." });
        return;
      }
      patch[box.delay === "first" ? "firstMs" : "everyMs"] = Math.round(
        seconds * 1000,
      );
    }

    const ok = await post(
      { intent: "save-lists", patch },
      `save:${draftKey(box.family)}`,
    );
    if (ok) {
      setListDrafts((prev) => ({
        ...prev,
        [draftKey(box.family)]: listToText(parsed.value),
      }));
    }
  }

  async function runTokenAction(token: string, action: string) {
    const ok = await post(
      { intent: "script-token-action", token, action },
      `token:${token}`,
    );
    if (!ok) return;
    setListDrafts((prev) => {
      const next = { ...prev };
      for (const box of BOXES) delete next[draftKey(box.family)];
      return next;
    });
  }

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(readableScript || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setNotice({ kind: "error", text: "Could not copy the script." });
    }
  }

  const busy = saving !== null;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Storefront script settings</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              These are the same Global / Home / PLP / PDP lists the merchant
              edits in PagePulse. Saving writes the template buckets, recomputes
              the union lists, rebuilds the storefront script, and syncs the
              Shopify metafield.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={appEnabled ? "success" : "destructive"}>
              App {appEnabled ? "on" : "off"}
            </Badge>
            {scriptHash && (
              <Badge variant="outline">hash {scriptHash.slice(0, 10)}</Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {readOnly && (
          <p className="text-sm rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            Demo store — editing is disabled.
          </p>
        )}
        {!appEnabled && !readOnly && (
          <p className="text-sm rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
            The app is off for this store. Saves still update the database, but
            the storefront serves no deferred/hidden behavior until a merchant
            turns the app on.
          </p>
        )}

        {notice && (
          <p
            className={cn(
              "text-sm rounded-md border p-3",
              notice.kind === "ok"
                ? "border-green-200 bg-green-50 text-green-900"
                : "border-red-200 bg-red-50 text-red-900",
            )}
          >
            {notice.text}
          </p>
        )}

        <div className="flex flex-wrap gap-1 border-b border-border">
          {TEMPLATE_SCOPES.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setScope(item)}
              className={cn(
                "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
                scope === item
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              {SCOPE_META[item].label}
            </button>
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{meta.note}</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {BOXES.map((box) => {
            const enabled = enabledFor(box.family);
            const value = textFor(box.family);
            const parsed = parseListText(value);
            const count = parsed.ok ? parsed.value.length : listFor(box.family).length;
            const saveKey = `save:${draftKey(box.family)}`;
            return (
              <div
                key={box.family}
                className={cn(
                  "rounded-lg border p-4 flex flex-col gap-3",
                  enabled ? "bg-card" : "bg-muted/40",
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold">{box.label}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {box.hint}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={enabled}
                    disabled={readOnly || busy}
                    onClick={() => void toggleBox(box)}
                    className={cn(
                      "shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                      enabled
                        ? "border-green-200 bg-green-100 text-green-800"
                        : "border-border bg-background text-muted-foreground",
                      (readOnly || busy) && "opacity-50",
                    )}
                  >
                    {saving === `toggle:${box.family}`
                      ? "Saving…"
                      : enabled
                        ? "On"
                        : "Off"}
                  </button>
                </div>

                <textarea
                  value={value}
                  disabled={readOnly || busy || !enabled}
                  onChange={(e) =>
                    setListDrafts((prev) => ({
                      ...prev,
                      [draftKey(box.family)]: e.target.value,
                    }))
                  }
                  placeholder={box.placeholder}
                  spellCheck={false}
                  rows={6}
                  className="w-full rounded-md border bg-background p-2 font-mono text-xs leading-5 disabled:opacity-60"
                />

                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="flex items-end gap-2">
                    {box.delay && (
                      <label className="text-xs text-muted-foreground">
                        Delay (seconds)
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={secondsFor(box)}
                          disabled={readOnly || busy || !enabled}
                          onChange={(e) =>
                            setDelayDrafts((prev) => ({
                              ...prev,
                              [delayKey(box.delay as DelayKind)]: e.target.value,
                            }))
                          }
                          className="mt-1 block w-24 rounded-md border bg-background px-2 py-1 text-sm text-foreground disabled:opacity-60"
                        />
                      </label>
                    )}
                    <span className="text-xs text-muted-foreground pb-2">
                      {count} {count === 1 ? "entry" : "entries"}
                    </span>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={readOnly || busy || !enabled}
                    onClick={() => void saveBox(box)}
                  >
                    {saving === saveKey ? "Saving…" : "Save"}
                  </Button>
                </div>

                {!enabled && (
                  <p className="text-xs text-muted-foreground">
                    This rule is off. Turning it back on restores the lists that
                    were saved before it was switched off.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Computed union lists (what the storefront script falls back to)
          </summary>
          <div className="mt-3 space-y-2">
            {BOXES.map((box) => {
              const tokens = unionOf(cfg, box.family);
              return (
                <div key={box.family} className="text-xs">
                  <span className="text-muted-foreground">{box.label}: </span>
                  {tokens.length === 0 ? (
                    <span className="italic">empty</span>
                  ) : (
                    <span className="font-mono break-all">
                      {tokens.join(", ")}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </details>

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">Audit context</p>
              <p className="text-xs text-muted-foreground">
                {auditSummary
                  ? `Last completed ${formatDate(auditSummary.completedAt)}${
                      auditSummary.variantCount != null
                        ? ` · ${auditSummary.variantCount} page pattern(s)`
                        : ""
                    }${
                      auditSummary.baseCount != null
                        ? ` · ${auditSummary.baseCount} base script(s)`
                        : ""
                    }`
                  : "No completed audit yet."}
              </p>
            </div>
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter scripts…"
              className="w-48 rounded-md border bg-background px-2 py-1 text-sm"
            />
          </div>

          {!summary || summary.topScripts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No script inventory from an audit yet.
            </p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No scripts match this page type{filter ? " and filter" : ""}.
            </p>
          ) : (
            <div className="max-h-96 overflow-auto rounded-md border divide-y">
              {rows.slice(0, 150).map((row) => (
                <div
                  key={row.token}
                  className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-xs truncate">{row.token}</p>
                    <p className="text-xs text-muted-foreground">
                      {row.pages.length > 0
                        ? `${row.pages.length} page(s)`
                        : "no pages recorded"}
                      {scope !== "global" && globalTokens.has(row.token)
                        ? " · Also in Global"
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.status && (
                      <Badge variant="outline">{row.status}</Badge>
                    )}
                    <select
                      value={actionFor(row.token, currentLists)}
                      disabled={readOnly || busy}
                      onChange={(e) =>
                        void runTokenAction(row.token, e.target.value)
                      }
                      className="rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-60"
                    >
                      {TOKEN_ACTIONS.map((action) => (
                        <option key={action.value} value={action.value}>
                          {action.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
              {rows.length > 150 && (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  Showing the first 150 of {rows.length}. Use the filter to
                  narrow the list.
                </p>
              )}
            </div>
          )}
        </div>

        <details className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-semibold">
            Compiled storefront script (read-only)
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">
              Built {formatDate(scriptBuiltAt)} · metafield{" "}
              {formatDate(metafieldSyncedAt)}
            </p>
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!readableScript}
                onClick={() => void copyScript()}
              >
                {copied ? "Copied" : "Copy script"}
              </Button>
            </div>
            <pre className="max-h-72 overflow-auto rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
              {readableScript || "No script stored yet."}
            </pre>
            <p className="text-sm font-medium">Hide CSS</p>
            <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
              {hiddenCss || "None"}
            </pre>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
