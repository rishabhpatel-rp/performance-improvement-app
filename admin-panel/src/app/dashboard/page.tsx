import Link from "next/link";
import { getDashboardStats, type DashboardStats } from "@/lib/queries";
import StatsCards from "@/components/stats-cards";
import ActivityTimeline from "@/components/activity-timeline";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { showDummyData } from "@/lib/data-source";

type RecentInstall = DashboardStats["recentInstalls"][number];

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      {showDummyData && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          Showing <strong>dummy data</strong> (SHOW_DUMMY_DATA=true). Disable it before go-live
          to read from the database.
        </div>
      )}
      <StatsCards stats={stats} />

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
