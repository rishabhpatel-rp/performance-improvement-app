import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatRelativeTime } from "@/lib/utils";
import type { PopupLeadRow } from "@/lib/types";

interface Props {
  leads: PopupLeadRow[];
  showShop?: boolean;
  title?: string;
}

function PanelStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="text-xl font-bold">{value}</p>
    </div>
  );
}

export default function PopupLeadsPanel({
  leads,
  showShop = true,
  title = "Help email leads",
}: Props) {
  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const last7 = leads.filter((lead) => new Date(lead.createdAt).getTime() >= sevenDaysAgo).length;
  const unique = new Set(showShop ? leads.map((l) => l.shopDomain) : leads.map((l) => l.email))
    .size;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-4">
          <PanelStat label="Recent" value={leads.length} />
          <PanelStat label="Last 7d" value={last7} />
          <PanelStat label={showShop ? "Stores" : "Unique"} value={unique} />
        </div>

        {leads.length === 0 ? (
          <p className="text-muted-foreground">No help emails yet.</p>
        ) : (
          <ul className="max-h-52 space-y-2 overflow-y-auto">
            {leads.map((lead) => (
              <li
                key={lead.id}
                className="flex items-center justify-between gap-3 border-b border-border pb-2 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{lead.email}</p>
                  {showShop && (
                    <p className="truncate text-xs text-muted-foreground">{lead.shopDomain}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {formatRelativeTime(lead.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
