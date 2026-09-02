import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

interface ConfigLike {
  appEnabled: boolean;
  script1Enabled: boolean;
  script2Enabled: boolean;
  script3Enabled: boolean;
  debugMode: boolean;
  scriptTitles: unknown;
  metaobjectId: string | null;
  updatedAt: Date | string;
}

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  return [];
}

function ToggleRow({ label, enabled }: { label: string; enabled: boolean }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-border last:border-0">
      <span className="text-sm">{label}</span>
      <Badge variant={enabled ? "success" : "outline"}>{enabled ? "On" : "Off"}</Badge>
    </div>
  );
}

function ListField({ label, items }: { label: string; items: string[] }) {
  return (
    <div className="py-2 border-b border-border last:border-0">
      <p className="text-sm font-medium mb-1">{label}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="text-sm text-muted-foreground list-disc list-inside space-y-0.5">
          {items.map((item, i) => (
            <li key={`${item}-${i}`} className="truncate">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function ConfigViewer({ config }: { config: ConfigLike | null }) {
  if (!config) {
    return (
      <p className="text-sm text-muted-foreground">
        No config has been synced from this store yet.
      </p>
    );
  }

  const scriptTitles = toStringArray(config.scriptTitles);

  return (
    <div className="space-y-1">
      <ToggleRow label="App Enabled" enabled={config.appEnabled} />
      <ToggleRow label="Script 1" enabled={config.script1Enabled} />
      <ToggleRow label="Script 2" enabled={config.script2Enabled} />
      <ToggleRow label="Script 3 (Style)" enabled={config.script3Enabled} />
      <ToggleRow label="Debug Mode" enabled={config.debugMode} />

      <ListField label="Script Titles" items={scriptTitles} />

      <div className="py-2 border-b border-border last:border-0">
        <p className="text-sm font-medium mb-1">Metaobject ID</p>
        <p className="text-sm text-muted-foreground truncate">
          {config.metaobjectId || "—"}
        </p>
      </div>

      <div className="py-2">
        <p className="text-sm font-medium mb-1">Last Synced</p>
        <p className="text-sm text-muted-foreground">{formatDate(config.updatedAt)}</p>
      </div>
    </div>
  );
}
