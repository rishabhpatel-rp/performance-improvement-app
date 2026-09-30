import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { DashboardStats } from "@/lib/queries";

export default function StatsCards({ stats }: { stats: DashboardStats }) {
  const cards = [
    { label: "Total Stores", value: stats.totalStores, href: "/dashboard/stores" },
    { label: "Active Stores", value: stats.activeStores, href: "/dashboard/stores?status=active" },
    { label: "App On Stores", value: stats.appOnStores, href: "/dashboard/stores?appEnabled=on" },
    {
      label: "Installed (7d)",
      value: stats.recentlyInstalledCount,
      href: "/dashboard/stores?sortBy=installedAt&sortDir=desc",
    },
    {
      label: "Total Products",
      value: stats.totalProducts.toLocaleString(),
      href: "/dashboard/stores",
    },
    { label: "Total Orders", value: stats.totalOrders.toLocaleString(), href: "/dashboard/stores" },
    { label: "Audits Completed", value: stats.auditsCompleted, href: "/dashboard/stores" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
      {cards.map((card) => {
        const content = (
          <Card className={card.href ? "transition-colors hover:border-primary" : undefined}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {card.label}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold">{card.value}</p>
            </CardContent>
          </Card>
        );

        return card.href ? (
          <Link key={card.label} href={card.href}>
            {content}
          </Link>
        ) : (
          <div key={card.label}>{content}</div>
        );
      })}
    </div>
  );
}
