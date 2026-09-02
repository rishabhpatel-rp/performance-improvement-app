import { getStoreByDomain } from "@/lib/queries";
import { notFound } from "next/navigation";
import StoreDetail from "@/components/store-detail";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const store = await getStoreByDomain(domain);

  if (!store) notFound();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">{store.shopName}</h1>
        <p className="text-muted-foreground">{store.shopDomain}</p>
      </div>
      <StoreDetail store={store} />
    </div>
  );
}
