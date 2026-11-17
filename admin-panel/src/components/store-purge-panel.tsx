"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function StorePurgePanel({
  domain,
  shopName,
  isActive,
  readOnly,
}: {
  domain: string;
  shopName: string;
  isActive: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (readOnly) return null;

  const close = () => {
    setOpen(false);
    setPassword("");
    setError(null);
  };

  const onConfirm = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/stores/${encodeURIComponent(domain)}/purge`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password, confirm: true }),
        },
      );
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        archiveId?: string;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error || `Request failed (${res.status})`);
        return;
      }
      close();
      router.push("/dashboard/archives");
      router.refresh();
    } catch {
      setError("Network error. Live data was not removed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card className="border-red-200">
        <CardHeader>
          <CardTitle className="text-red-700">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Remove this shop from the live database. A full snapshot is saved to{" "}
            <strong>Store archive</strong> first. Shopify{" "}
            <code className="text-xs">shop/redact</code> does the same
            automatically (no password).
          </p>
          {isActive && (
            <p className="text-sm text-amber-700">
              This install is still marked active. Purge is blocked until the
              app is uninstalled (inactive).
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="border-red-300 text-red-700 hover:bg-red-50"
            disabled={isActive || busy}
            onClick={() => setOpen(true)}
          >
            Remove from live DB…
          </Button>
        </CardContent>
      </Card>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="purge-title"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg space-y-4">
            <h2 id="purge-title" className="text-lg font-semibold text-red-700">
              Delete live store data?
            </h2>
            <p className="text-sm text-muted-foreground">
              You are removing <strong>{shopName}</strong> (
              <code className="text-xs">{domain}</code>) from the live database.
              A snapshot will be saved to Store archive. This cannot be undone
              without a restore action.
            </p>
            <div className="space-y-2">
              <Label htmlFor="purge-password">Re-enter your admin password</Label>
              <input
                id="purge-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="button"
                className="bg-red-600 text-white hover:bg-red-700"
                disabled={busy || !password}
                onClick={onConfirm}
              >
                {busy ? "Deleting…" : "Delete permanently"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
