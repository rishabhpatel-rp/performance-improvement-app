"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const MAX_HINT = 32_000;

export default function StoreAdminHeadHtml({
  domain,
  initialHtml,
  readOnly,
}: {
  domain: string;
  initialHtml: string;
  readOnly?: boolean;
}) {
  const [draft, setDraft] = useState(initialHtml);
  const [saved, setSaved] = useState(initialHtml);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const dirty = draft !== saved;

  async function post(intent: "save" | "clear") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(domain)}/admin-head`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          intent,
          html: intent === "clear" ? "" : draft,
        }),
      });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        metafieldStatus?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Save failed (HTTP ${res.status}).`);
        return;
      }
      const next = intent === "clear" ? "" : draft;
      setSaved(next);
      setDraft(next);
      setNotice(
        data.metafieldStatus === "written"
          ? "Saved. HTML is injected at the start of the theme app embed head slot on the storefront."
          : data.metafieldStatus === "skipped_inactive_store"
            ? "Saved in database (store inactive — metafield not synced)."
            : "Saved.",
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Admin head HTML (ops only)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Not available in the merchant app. Markup is stored on this shop only and rendered as
          early as the PagePulse theme embed allows (before the performance script). Use tags like{" "}
          <code className="text-xs">&lt;link&gt;</code>,{" "}
          <code className="text-xs">&lt;meta&gt;</code> or{" "}
          <code className="text-xs">&lt;style&gt;</code>.{" "}
          <code className="text-xs">&lt;script&gt;</code> blocks are rejected because scripts
          inserted this way never execute.
        </p>
        <textarea
          className="min-h-[140px] w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
          value={draft}
          disabled={readOnly || busy}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={'<meta name="example" content="ops">'}
          maxLength={MAX_HINT}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={readOnly || busy || !dirty}
            onClick={() => void post("save")}
          >
            {busy ? "Saving…" : "Save to storefront"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={readOnly || busy || !saved}
            onClick={() => void post("clear")}
          >
            Clear
          </Button>
          <span className="text-xs text-muted-foreground">
            {draft.length.toLocaleString()} / {MAX_HINT.toLocaleString()} chars
          </span>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && <p className="text-sm text-muted-foreground">{notice}</p>}
      </CardContent>
    </Card>
  );
}
