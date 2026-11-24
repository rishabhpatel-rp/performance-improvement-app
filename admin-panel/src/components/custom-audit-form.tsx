"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PpBanner, PpSpinner } from "@/components/pp/polaris-shims";
import Step2AuditTable from "@/components/step2/step2-audit-table";
import StoreScriptDiagnostics from "@/components/store-script-diagnostics";
import type { CustomAuditRunView } from "@/lib/custom-audit";

interface Props {
  canEdit: boolean;
  demoMode: boolean;
}

export default function CustomAuditForm({ canEdit, demoMode }: Props) {
  const [url, setUrl] = useState("");
  const [password, setPassword] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [view, setView] = useState<CustomAuditRunView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pollInFlight = useRef(false);

  const applyView = useCallback((next: CustomAuditRunView) => setView(next), []);

  const load = useCallback(
    async (id: string) => {
      if (pollInFlight.current) return;
      pollInFlight.current = true;
      try {
        const res = await fetch(`/api/custom-audit?runId=${encodeURIComponent(id)}`, {
          cache: "no-store",
        });
        const data = await res.json().catch(() => null);
        if (res.ok && data?.ok === true && data.run) applyView(data.run as CustomAuditRunView);
      } catch {
        /* keep the last known state on transient failures */
      } finally {
        pollInFlight.current = false;
      }
    },
    [applyView],
  );

  useEffect(() => {
    if (!runId) return;
    const running = view?.status === "queued" || view?.status === "running" || view == null;
    if (!running) return;
    void load(runId);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void load(runId);
    }, 5000);
    return () => clearInterval(id);
  }, [runId, view, load]);

  async function start(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const submittedPassword = password;
    setPassword("");
    try {
      const res = await fetch("/api/custom-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, password: submittedPassword || undefined }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok !== true) {
        throw new Error(data?.error || "Could not start the scan.");
      }
      setRunId(data.runId as string);
      setView(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the scan.");
    } finally {
      setBusy(false);
    }
  }

  const running = view?.status === "queued" || view?.status === "running" || busy;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Scan any storefront URL</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={start} className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1">
              <label htmlFor="custom-audit-url" className="text-sm font-medium">
                URL
              </label>
              <Input
                id="custom-audit-url"
                type="url"
                required
                placeholder="https://example.com"
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={!canEdit}
              />
            </div>
            <div className="flex-1 space-y-1">
              <label htmlFor="custom-audit-password" className="text-sm font-medium">
                Storefront password <span className="text-muted-foreground">(optional)</span>
              </label>
              <Input
                id="custom-audit-password"
                type="password"
                autoComplete="off"
                placeholder="Only for password-protected sites"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={!canEdit}
              />
            </div>
            <Button type="submit" disabled={!canEdit || busy || running}>
              {busy ? "Starting…" : "Search"}
            </Button>
          </form>
          {demoMode && (
            <p className="mt-3 text-xs text-muted-foreground">Demo mode: scans are disabled.</p>
          )}
          {error && (
            <div className="mt-4">
              <PpBanner tone="critical">{error}</PpBanner>
            </div>
          )}
        </CardContent>
      </Card>

      {running && view && (
        <Card>
          <CardContent className="flex items-center gap-3 pt-6 text-sm">
            <PpSpinner />
            <span>
              {view.phase === "discovering"
                ? "Finding Home, Collection and Product pages…"
                : view.phase === "scanning"
                  ? `Scanning page ${view.pageIndex} of ${view.totalPages}…`
                  : view.phase === "finalizing"
                    ? "Building the scan summary and script…"
                    : "Starting the scan…"}
            </span>
          </CardContent>
        </Card>
      )}

      {view?.status === "failed" && (
        <PpBanner tone="critical">{view.error || "The scan failed. Please try again."}</PpBanner>
      )}

      {view?.status === "complete" && (
        <div className="space-y-6">
          {view.summary ? (
            <Step2AuditTable
              summary={view.summary}
              config={{}}
              scope="global"
              pendingToken={null}
              readOnly
              onTokenAction={() => {}}
            />
          ) : (
            <PpBanner tone="info">No scan summary was produced for this run.</PpBanner>
          )}
          <StoreScriptDiagnostics
            readableScript={view.readableScript ?? ""}
            scriptBuiltAt={view.finishedAt}
            metafieldSyncedAt={null}
            scriptHash={null}
          />
        </div>
      )}
    </div>
  );
}
