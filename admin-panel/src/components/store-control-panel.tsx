"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
type Health = {
  sessionOk?: boolean;
  embedStatus?: string;
  embedActivateUrl?: string | null;
  sessionError?: string | null;
};

type StatePoll = {
  config?: { appEnabled?: boolean; adminManaged?: boolean };
  auditStatus?: { running?: boolean; complete?: boolean; failed?: boolean };
  health?: Health;
};

export default function StoreControlPanel({
  domain,
  initialAppEnabled,
  initialAdminManaged,
  readOnly,
}: {
  domain: string;
  initialAppEnabled: boolean;
  initialAdminManaged: boolean;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [appEnabled, setAppEnabled] = useState(initialAppEnabled);
  const [adminManaged, setAdminManaged] = useState(initialAdminManaged);
  const [health, setHealth] = useState<Health>({});
  const [auditRunning, setAuditRunning] = useState(false);
  const [forceOn, setForceOn] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refreshFromState = useCallback(async () => {
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(domain)}/state`, {
        cache: "no-store",
      });
      const data = (await res.json().catch(() => null)) as StatePoll & {
        ok?: boolean;
      };
      if (!res.ok || !data?.ok) return;
      if (data.config?.appEnabled !== undefined) {
        setAppEnabled(data.config.appEnabled === true);
      }
      if (data.config?.adminManaged !== undefined) {
        setAdminManaged(data.config.adminManaged === true);
      }
      if (data.health) setHealth(data.health);
      if (data.auditStatus?.running !== undefined) {
        setAuditRunning(data.auditStatus.running === true);
      }
    } catch {
      /* ignore poll errors */
    }
  }, [domain]);

  useEffect(() => {
    void refreshFromState();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void refreshFromState();
    }, 5000);
    return () => clearInterval(id);
  }, [refreshFromState]);

  async function postControl(body: Record<string, unknown>) {
    setBusy(String(body.intent));
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/stores/${encodeURIComponent(domain)}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok || data?.ok !== true) {
        setError(
          (typeof data?.error === "string" && data.error) ||
            (typeof data?.message === "string" && data.message) ||
            `Request failed (HTTP ${res.status})`,
        );
        return;
      }
      if (body.intent === "toggle-app" && typeof body.appEnabled === "boolean") {
        setAppEnabled(body.appEnabled);
        if (data.forcedOnWithoutEmbed) {
          setNotice(
            "App enabled in database (force). Theme embed may still be off — storefront may not load the script until embed is on.",
          );
        } else {
          setNotice(body.appEnabled ? "App enabled." : "App disabled.");
        }
      }
      if (body.intent === "set-admin-managed" && typeof body.adminManaged === "boolean") {
        setAdminManaged(body.adminManaged);
        setNotice(
          body.adminManaged
            ? "Merchant app locked for admin control."
            : "Merchant can edit again.",
        );
      }
      if (body.intent === "start-audit") setNotice("Audit started.");
      if (body.intent === "stop-audit") setNotice("Audit stop requested.");
      router.refresh();
      await refreshFromState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(null);
    }
  }

  const embedBadge =
    health.embedStatus === "enabled"
      ? "success"
      : health.embedStatus === "disabled"
        ? "destructive"
        : "outline";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Store control (remote)</CardTitle>
        <p className="text-sm text-muted-foreground">
          Operates the merchant app via the internal API. First save locks the shop for
          merchant edits (release below when handing back).
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && (
          <p className="text-sm rounded-md border border-red-200 bg-red-50 p-3 text-red-900">
            {error}
          </p>
        )}
        {notice && (
          <p className="text-sm rounded-md border border-green-200 bg-green-50 p-3 text-green-900">
            {notice}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Badge variant={appEnabled ? "success" : "destructive"}>
            App {appEnabled ? "on" : "off"}
          </Badge>
          <Badge variant={adminManaged ? "default" : "outline"}>
            {adminManaged ? "Admin-managed" : "Merchant self-service"}
          </Badge>
          <Badge variant={health.sessionOk ? "success" : "destructive"}>
            Session {health.sessionOk ? "ok" : "missing"}
          </Badge>
          <Badge variant={embedBadge}>Embed {health.embedStatus ?? "unknown"}</Badge>
          {auditRunning && <Badge variant="outline">Audit running</Badge>}
        </div>

        {health.embedActivateUrl && (
          <p className="text-xs text-muted-foreground">
            <a
              href={health.embedActivateUrl}
              target="_blank"
              rel="noreferrer"
              className="text-primary underline"
            >
              Open theme editor (enable app embed)
            </a>
          </p>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={forceOn}
              onChange={(e) => setForceOn(e.target.checked)}
              disabled={readOnly || Boolean(busy)}
            />
            Force ON (skip embed check)
          </label>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={readOnly || Boolean(busy) || appEnabled}
            onClick={() =>
              void postControl({
                intent: "toggle-app",
                appEnabled: true,
                force: forceOn,
              })
            }
          >
            {busy === "toggle-app" ? "…" : "Turn app ON"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly || Boolean(busy) || !appEnabled}
            onClick={() =>
              void postControl({ intent: "toggle-app", appEnabled: false })
            }
          >
            Turn app OFF
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly || Boolean(busy) || !appEnabled || auditRunning}
            onClick={() => void postControl({ intent: "start-audit" })}
          >
            Start audit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly || Boolean(busy) || !auditRunning}
            onClick={() => void postControl({ intent: "stop-audit" })}
          >
            Stop audit
          </Button>
        </div>

        <div className="flex flex-wrap gap-2 pt-2 border-t">
          <Button
            type="button"
            size="sm"
            variant={adminManaged ? "outline" : "default"}
            disabled={readOnly || Boolean(busy) || adminManaged}
            onClick={() =>
              void postControl({ intent: "set-admin-managed", adminManaged: true })
            }
          >
            Lock for admin
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={readOnly || Boolean(busy) || !adminManaged}
            onClick={() =>
              void postControl({ intent: "set-admin-managed", adminManaged: false })
            }
          >
            Release to merchant
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}