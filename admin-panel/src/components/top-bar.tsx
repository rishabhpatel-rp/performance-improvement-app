"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TopBarProps {
  title: string;
  demoMode: "on" | "off";
}

export default function TopBar({ title, demoMode }: TopBarProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [optimisticOn, setOptimisticOn] = useState(demoMode === "on");

  async function handleToggle() {
    const next = !optimisticOn;
    setOptimisticOn(next);

    try {
      const res = await fetch("/api/demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error("Failed to update demo mode");
    } catch (error) {
      console.error(error);
      setOptimisticOn(!next); // revert on failure
      return;
    }

    startTransition(() => {
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-4 pb-2">
      <div className="flex items-center gap-3">
        <h1 className="text-3xl font-bold">{title}</h1>
        {optimisticOn && <Badge variant="secondary">Demo mode</Badge>}
      </div>

      <label className="flex items-center gap-2 cursor-pointer select-none">
        <span className="text-sm text-muted-foreground">Demo data</span>
        <button
          type="button"
          role="switch"
          aria-checked={optimisticOn}
          disabled={isPending}
          onClick={handleToggle}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
            optimisticOn ? "bg-primary" : "bg-muted",
          )}
        >
          <span
            className={cn(
              "inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform",
              optimisticOn ? "translate-x-6" : "translate-x-1",
            )}
          />
        </button>
      </label>
    </div>
  );
}
