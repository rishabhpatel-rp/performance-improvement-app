import { getStores } from "@/lib/queries";
import { getDemoMode } from "@/lib/demo-mode";
import StoreTable from "@/components/store-table";
import TopBar from "@/components/top-bar";

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
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
      page: params.page ? parseInt(params.page, 10) : 1,
      pageSize: 20,
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
      />
    </div>
  );
}
