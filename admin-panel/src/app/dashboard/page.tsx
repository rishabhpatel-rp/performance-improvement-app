import Link from "next/link";
import { getDashboardStats, type DashboardStats } from "@/lib/queries";
import { getDemoMode } from "@/lib/demo-mode";
import StatsCards from "@/components/stats-cards";
import ActivityTimeline from "@/components/activity-timeline";
import TopBar from "@/components/top-bar";
import InstallsChart from "@/components/installs-chart";
import CountryChart from "@/components/country-chart";
import PlanChart from "@/components/plan-chart";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";

type RecentInstall = DashboardStats["recentInstalls"][number];

export default async function DashboardPage() {
  const [stats, demoMode] = await Promise.all([getDashboardStats(), getDemoMode()]);

  return (
    <div className="space-y-8">
      <TopBar title="Dashboard" demoMode={demoMode} />
      <StatsCards stats={stats} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="lg:col-span-2">
          <InstallsChart data={stats.installsByDay} />
        </div>
        <CountryChart data={stats.storesByCountry} />
        <PlanChart data={stats.storesByPlan} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-semibold mb-4">Recent Installs</h2>
          {stats.recentInstalls.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stores yet.</p>
          ) : (
            <ul className="space-y-2">
              {stats.recentInstalls.map((store: RecentInstall) => (
                <li
                  key={store.id}
                  className="flex items-center justify-between rounded-md border border-border bg-white p-3"
                >
                  <div className="min-w-0">
                    <Link
                      href={`/dashboard/stores/${store.shopDomain}`}
                      className="font-medium hover:underline truncate block"
                    >
                      {store.shopName}
                    </Link>
                    <p className="text-xs text-muted-foreground truncate">
                      {store.shopDomain}
                      {store.country ? ` · ${store.country}` : ""}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
                    <Badge variant={store.isActive ? "success" : "destructive"}>
                      {store.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDate(store.installedAt)}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
          <ActivityTimeline activities={stats.recentActivity} />
        </div>
      </div>
    </div>
  );
}
