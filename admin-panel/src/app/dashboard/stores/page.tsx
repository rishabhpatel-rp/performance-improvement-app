import { getStores } from "@/lib/queries";
import { getDemoMode } from "@/lib/demo-mode";
import StoreTable from "@/components/store-table";
import TopBar from "@/components/top-bar";

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{
    search?: string;
    status?: string;
    appEnabled?: string;
    page?: string;
    sortBy?: string;
    sortDir?: string;
  }>;
}) {
  const params = await searchParams;

  const [result, demoMode] = await Promise.all([
    getStores({
      search: params.search,
      isActive:
        params.status === "active"
          ? true
          : params.status === "inactive"
            ? false
            : undefined,
      appEnabled:
        params.appEnabled === "on" ? true : params.appEnabled === "off" ? false : undefined,
      page: params.page ? parseInt(params.page, 10) : 1,
      pageSize: 20,
      sortBy: params.sortBy,
      sortDir: params.sortDir,
    }),
    getDemoMode(),
  ]);

  return (
    <div className="space-y-6">
      <TopBar title="Stores" demoMode={demoMode} />
      <StoreTable
        stores={result.stores}
        total={result.total}
        page={result.page}
        totalPages={result.totalPages}
        search={params.search || ""}
        status={params.status || "all"}
        appEnabledFilter={params.appEnabled || "all"}
        sortBy={params.sortBy || "installedAt"}
        sortDir={params.sortDir === "asc" ? "asc" : "desc"}
      />
    </div>
  );
}
