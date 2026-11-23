import type { AuditFleetSummary } from "@/lib/audit-fleet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AuditFleetPanel({ fleet }: { fleet: AuditFleetSummary }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">Audit queue</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-4">
          <FleetStat label="Queued" value={fleet.queued} />
          <FleetStat label="Running" value={fleet.running} />
          <FleetStat label="Failed (24h)" value={fleet.failedLast24h} />
        </div>
        {fleet.oldestQueuedMinutes != null && fleet.queued > 0 && (
          <p className="text-muted-foreground">
            Oldest queued job: ~{fleet.oldestQueuedMinutes} min
          </p>
        )}
        {fleet.runningShops.length > 0 && (
          <ul className="space-y-1 text-muted-foreground">
            {fleet.runningShops.map((row) => (
              <li key={row.shopDomain} className="truncate">
                <span className="text-foreground font-medium">{row.shopDomain}</span>
                {row.startedAt ? ` · since ${new Date(row.startedAt).toLocaleTimeString()}` : ""}
              </li>
            ))}
          </ul>
        )}
        {fleet.queued === 0 && fleet.running === 0 && (
          <p className="text-muted-foreground">No audits in the queue.</p>
        )}
      </CardContent>
    </Card>
  );
}

function FleetStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}
