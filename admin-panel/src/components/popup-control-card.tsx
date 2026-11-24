"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

interface Props {
  initialEnabled: boolean;
  canEdit: boolean;
  demoMode: boolean;
}

export default function PopupControlCard({ initialEnabled, canEdit, demoMode }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [error, setError] = useState("");
  const [isPending, startTransition] = useTransition();

  async function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    setError("");
    try {
      const res = await fetch("/api/settings/popup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || data?.ok !== true) {
        throw new Error(data?.error || "Failed to update the popup setting.");
      }
      startTransition(() => router.refresh());
    } catch (err) {
      setEnabled(!next);
      setError(err instanceof Error ? err.message : "Failed to update the popup setting.");
    }
  }

  return (
    <section className="rounded-lg border border-border bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-6">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">Step 2 offer popup</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            When on, every store sees the &ldquo;Boost Your Site Performance&rdquo; offer popup as
            soon as they reach Step 2 in the merchant app.
          </p>
          {demoMode && (
            <p className="text-xs text-muted-foreground">Demo mode: changes are disabled.</p>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
          <span className="text-sm font-medium">{enabled ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label="Show Step 2 offer popup for every store"
            disabled={!canEdit || isPending}
            onClick={handleToggle}
            className={cn(
              "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
              enabled ? "bg-primary" : "bg-muted",
            )}
          >
            <span
              className={cn(
                "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
                enabled ? "translate-x-6" : "translate-x-1",
              )}
            />
          </button>
        </label>
      </div>
    </section>
  );
}
