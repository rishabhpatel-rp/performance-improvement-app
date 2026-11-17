"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

export default function StoreScriptDiagnostics({
  readableScript,
  scriptBuiltAt,
  metafieldSyncedAt,
  scriptHash,
}: {
  readableScript: string;
  scriptBuiltAt: string | null;
  metafieldSyncedAt: string | null;
  scriptHash: string | null;
}) {
  const [copied, setCopied] = useState(false);

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(readableScript || "");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Storefront script diagnostics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Built {formatDate(scriptBuiltAt)} · metafield synced{" "}
          {formatDate(metafieldSyncedAt)}
          {scriptHash ? ` · hash ${scriptHash.slice(0, 12)}…` : ""}
        </p>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!readableScript}
            onClick={() => void copyScript()}
          >
            {copied ? "Copied" : "Copy readable script"}
          </Button>
        </div>
        <p className="text-sm font-medium">Readable script</p>
        <pre className="max-h-72 overflow-auto rounded-md border bg-muted/30 p-2 text-xs whitespace-pre-wrap">
          {readableScript || "No script stored yet."}
        </pre>
      </CardContent>
    </Card>
  );
}
