"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";

/** Display/copy as compact minified JS (strip comments + collapse whitespace). */
export function minifyScriptForDisplay(source: string): string {
  if (!source.trim()) return "";
  let out = "";
  let i = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (inLineComment) {
      if (c === "\n") inLineComment = false;
      i += 1;
      continue;
    }
    if (inBlockComment) {
      if (c === "*" && next === "/") {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (!inSingle && !inDouble && !inTemplate) {
      if (c === "/" && next === "/") {
        inLineComment = true;
        i += 2;
        continue;
      }
      if (c === "/" && next === "*") {
        inBlockComment = true;
        i += 2;
        continue;
      }
    }
    if (inSingle) {
      out += c;
      if (c === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (c === "'") inSingle = false;
      i += 1;
      continue;
    }
    if (inDouble) {
      out += c;
      if (c === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (c === '"') inDouble = false;
      i += 1;
      continue;
    }
    if (inTemplate) {
      out += c;
      if (c === "\\" && next) {
        out += next;
        i += 2;
        continue;
      }
      if (c === "`") inTemplate = false;
      i += 1;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      i += 1;
      continue;
    }
    if (c === "`") {
      inTemplate = true;
      out += c;
      i += 1;
      continue;
    }
    if (/\s/.test(c)) {
      const prev = out[out.length - 1];
      const peek = source.slice(i).match(/^\s*/)![0].length;
      const after = source[i + peek] ?? "";
      if (prev && after && /[\w$]/.test(prev) && /[\w$]/.test(after)) {
        out += " ";
      }
      i += peek || 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out.trim();
}

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
  const minified = minifyScriptForDisplay(readableScript || "");

  async function copyScript() {
    try {
      await navigator.clipboard.writeText(minified || "");
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
          Built {formatDate(scriptBuiltAt)} · metafield synced {formatDate(metafieldSyncedAt)}
          {scriptHash ? ` · hash ${scriptHash.slice(0, 12)}…` : ""}
        </p>
        <div className="flex justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!minified}
            onClick={() => void copyScript()}
          >
            {copied ? "Copied" : "Copy minified script"}
          </Button>
        </div>
        <p className="text-sm font-medium">Readable script (minified)</p>
        <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 text-[10px] leading-tight whitespace-pre-wrap break-all">
          {minified || "No script stored yet."}
        </pre>
      </CardContent>
    </Card>
  );
}
