import Link from "next/link";
import { listStoreArchives } from "@/lib/store-archive";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function ArchivesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total, pageSize } = await listStoreArchives({ search: q, page });
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Archived stores</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Snapshots kept when live DB rows were removed (Shopify{" "}
          <code className="text-xs">shop/redact</code> or manual purge). Internal
          ops retention — not a live install.
        </p>
      </div>

      <form className="flex gap-2" method="get">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search domain, name, email…"
          className="flex h-10 w-full max-w-md rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Search
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {total} archive{total === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="py-2 pr-3 font-medium">Shop</th>
                <th className="py-2 pr-3 font-medium">Email</th>
                <th className="py-2 pr-3 font-medium">Reason</th>
                <th className="py-2 pr-3 font-medium">Actor</th>
                <th className="py-2 pr-3 font-medium">Installed</th>
                <th className="py-2 font-medium">Archived</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-muted-foreground">
                    No archives yet.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="border-b border-border/60">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{row.shopName || "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {row.shopDomain}
                      </div>
                    </td>
                    <td className="py-2 pr-3 break-all">{row.email || "—"}</td>
                    <td className="py-2 pr-3">
                      <code className="text-xs">{row.reason}</code>
                    </td>
                    <td className="py-2 pr-3">{row.actorEmail || "—"}</td>
                    <td className="py-2 pr-3">{formatDate(row.installedAt)}</td>
                    <td className="py-2">{formatDate(row.redactedAt)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>

          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 text-sm">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                {page > 1 && (
                  <Link
                    className="text-primary hover:underline"
                    href={`/dashboard/archives?page=${page - 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                  >
                    Previous
                  </Link>
                )}
                {page < totalPages && (
                  <Link
                    className="text-primary hover:underline"
                    href={`/dashboard/archives?page=${page + 1}${q ? `&q=${encodeURIComponent(q)}` : ""}`}
                  >
                    Next
                  </Link>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
