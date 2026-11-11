"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const TABS = [
  { id: "global", label: "Global", suffix: "Global" },
  { id: "home", label: "Home", suffix: "Home" },
  { id: "collection", label: "PLP", suffix: "Collection" },
  { id: "product", label: "PDP", suffix: "Product" },
] as const;

type ScopeId = (typeof TABS)[number]["id"];

const BOXES: Array<{
  family: "defer" | "hide" | "first" | "every";
  label: string;
  hint: string;
  delay?: "first" | "every";
}> = [
  { family: "defer", label: "Defer Heavy Scripts", hint: "Held until the visitor interacts." },
  { family: "hide", label: "Hide Lastfold Classes", hint: "Hidden until the visitor interacts." },
  { family: "first", label: "Delay Scripts for First User", hint: "Delayed for a first-time visitor.", delay: "first" },
  { family: "every", label: "Delay Scripts", hint: "Delayed on every visit.", delay: "every" },
];

const ACTIONS = [
  { value: "defer", label: "Defer until interaction" },
  { value: "delay_first", label: "Delay (first user)" },
  { value: "delay_every", label: "Delay (every visit)" },
  { value: "protected", label: "Keep protected" },
];

type Summary = {
  topScripts: Array<{ token: string; pages?: string[]; status?: string }>;
  pageRoles: Record<string, string>;
};

function asList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];
}

function column(family: string, suffix: string): string {
  if (family === "defer") return `auditDefer${suffix}`;
  if (family === "hide") return `auditHide${suffix}`;
  if (family === "first") return `firstUserDelayScripts${suffix}`;
  return `staticDeferDefaults${suffix}`;
}

function msColumn(kind: "first" | "every", suffix: string): string {
  return kind === "first" ? `firstUserDelayMs${suffix}` : `everyTimeDelayMs${suffix}`;
}

function scriptsForScope(summary: Summary | null, scope: ScopeId) {
  const rows = summary?.topScripts || [];
  const roles = summary?.pageRoles || {};
  if (scope === "global") {
    const present = [...new Set(Object.values(roles).filter((r) =>
      r === "home" || r === "collection" || r === "product"))];
    if (!present.length) return rows;
    return rows.filter((row) => {
      const have = new Set((row.pages || []).map((p) => roles[p]).filter(Boolean));
      return present.every((role) => have.has(role));
    });
  }
  const want = scope === "collection" ? "collection" : scope === "product" ? "product" : "home";
  return rows.filter((row) => (row.pages || []).some((p) => roles[p] === want));
}

function actionFor(token: string, lists: { defer: string[]; first: string[]; every: string[] }) {
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
  summary,
  readOnly = false,
}: {
  domain: string;
  config: Record<string, unknown> | null;
  appEnabled: boolean;
  readableScript: string;
  hiddenCss: string;
  scriptBuiltAt: string | null;
  metafieldSyncedAt: string | null;
  summary: Summary | null;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [scope, setScope] = useState<ScopeId>("global");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [secondsDraft, setSecondsDraft] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const tab = TABS.find((t) => t.id === scope) || TABS[0];

  const lists = useMemo(() => {
    const read = (family: string) => asList(config?.[column(family, tab.suffix)]);
    return { defer: read("defer"), hide: read("hide"), first: read("first"), every: read("every") };
  }, [config, tab.suffix]);

  const globalNames = useMemo(() => {
    return new Set([
      ...asList(config?.auditDeferGlobal),
      ...asList(config?.firstUserDelayScriptsGlobal),
      ...asList(config?.staticDeferDefaultsGlobal),
    ]);
  }, [config]);

  async function post(body: object, key: string) {
    setSaving(key);
    setMessage(null);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(domain)}/script`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, scope }),
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(data.error || "Save failed");
        return;
      }
      const status = data.metafieldStatus;
      setMessage(
        status === "written" || status === "noop"
          ? "Saved. The store loads this script on the next full page load."
          : `Saved in the database. Metafield sync: ${status || "unknown"}.`,
      );
      router.refresh();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(null);
    }
  }

  function textFor(family: string) {
    const key = column(family, tab.suffix);
    return drafts[key] ?? JSON.stringify(lists[family as keyof typeof lists], null, 2);
  }

  return (
    <Card className="lg:col-span-3">
      <CardHeader>
        <CardTitle>Storefront lists</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {readOnly && (
          <p className="text-sm text-muted-foreground">
            Demo store. Saves are off.
          </p>
        )}
        {!appEnabled && !readOnly && (
          <p className="text-sm text-muted-foreground">
            App is off. The store is not running this script until the app is turned on.
          </p>
        )}
        <div className="flex gap-2 flex-wrap">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setScope(item.id)}
              className={`px-3 py-1 text-sm rounded-full border ${
                scope === item.id ? "bg-foreground text-background" : "bg-background"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
        {scope !== "global" && (
          <p className="text-sm text-muted-foreground">
            This page also uses every name in the Global tab.
          </p>
        )}
        {message && <p className="text-sm">{message}</p>}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {BOXES.map((box) => {
            const key = column(box.family, tab.suffix);
            const delayKey = box.delay ? msColumn(box.delay, tab.suffix) : null;
            const fieldName =
              box.family === "defer"
                ? "auditDeferArray"
                : box.family === "hide"
                  ? "auditHideSelectors"
                  : box.family === "first"
                    ? "firstUserDelayScripts"
                    : "staticDeferDefaults";
            const enabledKey = `${fieldName}Enabled`;
            const enabled = config?.[enabledKey] !== false;
            const seconds = delayKey ? Math.floor(Number(config?.[delayKey] ?? 0) / 1000) : null;
            return (
              <div key={key} className="border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">{box.label}</p>
                  <button
                    type="button"
                    className="text-xs underline"
                    disabled={readOnly || saving === fieldName}
                    onClick={() =>
                      post(
                        { intent: "toggle", field: fieldName, enabled: !enabled },
                        fieldName,
                      )
                    }
                  >
                    {enabled ? "On" : "Off"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">{box.hint}</p>
                {delayKey && (
                  <label className="text-xs flex items-center gap-2">
                    Delay seconds
                    <input
                      key={delayKey}
                      type="number"
                      min={0}
                      value={secondsDraft[delayKey] ?? String(seconds ?? 0)}
                      onChange={(e) =>
                        setSecondsDraft((prev) => ({ ...prev, [delayKey]: e.target.value }))
                      }
                      className="border rounded px-2 py-1 w-20"
                    />
                  </label>
                )}
                <textarea
                  className="w-full min-h-28 text-xs font-mono border rounded p-2"
                  value={textFor(box.family)}
                  onChange={(e) => setDrafts((prev) => ({ ...prev, [key]: e.target.value }))}
                />
                <button
                  type="button"
                  className="text-sm border rounded px-3 py-1"
                  disabled={readOnly || saving === key}
                  onClick={() => {
                    let parsed: string[];
                    try {
                      const value = JSON.parse(textFor(box.family));
                      if (!Array.isArray(value) || value.some((x) => typeof x !== "string")) {
                        setMessage("Must be a JSON array of strings.");
                        return;
                      }
                      parsed = value;
                    } catch {
                      setMessage("Invalid JSON.");
                      return;
                    }
                    const patch: Record<string, unknown> = { [box.family]: parsed };
                    if (delayKey && box.delay) {
                      const sec = Number(secondsDraft[delayKey] ?? seconds ?? 0);
                      if (!Number.isFinite(sec) || sec < 0) {
                        setMessage("Delay must be zero or greater.");
                        return;
                      }
                      patch[box.delay === "first" ? "firstMs" : "everyMs"] = Math.round(sec * 1000);
                    }
                    void post({ intent: "save-lists", patch }, key);
                  }}
                >
                  {saving === key ? "Saving…" : "Save"}
                </button>
              </div>
            );
          })}
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Scan summary</p>
          {!summary ? (
            <p className="text-sm text-muted-foreground">No scan yet.</p>
          ) : (
            <ul className="text-sm divide-y border rounded">
              {scriptsForScope(summary, scope).map((row) => (
                <li key={row.token} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-mono truncate">{row.token}</span>
                  <span className="flex items-center gap-2">
                    {scope !== "global" && globalNames.has(row.token) && (
                      <span className="text-xs text-muted-foreground">Also in Global</span>
                    )}
                    <select
                      className="border rounded px-2 py-1 text-xs"
                      value={actionFor(row.token, lists)}
                      disabled={readOnly}
                      onChange={(e) =>
                        void post(
                          { intent: "script-token-action", token: row.token, action: e.target.value },
                          row.token,
                        )
                      }
                    >
                      {ACTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="space-y-2">
          <p className="text-sm font-medium">Readable script</p>
          <p className="text-xs text-muted-foreground">
            Built {scriptBuiltAt || "—"} · metafield {metafieldSyncedAt || "—"}
          </p>
          <pre className="text-xs overflow-auto max-h-64 border rounded p-2 whitespace-pre-wrap">
            {readableScript || "No script stored yet."}
          </pre>
          <p className="text-sm font-medium">Hide CSS</p>
          <pre className="text-xs overflow-auto max-h-40 border rounded p-2 whitespace-pre-wrap">
            {hiddenCss || "None"}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
