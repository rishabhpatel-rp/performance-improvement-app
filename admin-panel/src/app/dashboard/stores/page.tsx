import { getStores } from "@/lib/queries";
import StoreTable from "@/components/store-table";

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const result = await getStores({
    search: params.search,
    isActive:
      params.status === "active"
        ? true
        : params.status === "inactive"
          ? false
          : undefined,
    page: params.page ? parseInt(params.page, 10) : 1,
    pageSize: 20,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Stores</h1>
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
