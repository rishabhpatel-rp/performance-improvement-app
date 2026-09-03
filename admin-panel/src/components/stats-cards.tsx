import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardStats } from "@/lib/queries";

export default function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: "Total Stores", value: stats.totalStores },
    { label: "Active Stores", value: stats.activeStores },
    { label: "Inactive Stores", value: stats.inactiveStores },
    { label: "Installed (7d)", value: stats.recentlyInstalledCount },
    { label: "Total Products", value: stats.totalProducts.toLocaleString() },
    { label: "Total Orders", value: stats.totalOrders.toLocaleString() },
    { label: "Audits Completed", value: stats.auditsCompleted },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
      {cards.map((card) => (
        <Card key={card.label}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {card.label}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{card.value}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
