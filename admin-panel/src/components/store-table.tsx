"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import type { StoresResult } from "@/lib/queries";

type StoreRow = StoresResult["stores"][number];

interface StoreTableProps {
  stores: StoreRow[];
  total: number;
  page: number;
  totalPages: number;
  search: string;
  status: string;
}

export default function StoreTable({
  stores,
  total,
  page,
  totalPages,
  search,
  status,
}: StoreTableProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(search);

  const navigate = (params: { search?: string; status?: string; page?: number }) => {
    const next = new URLSearchParams();
    const nextSearch = params.search ?? search;
    const nextStatus = params.status ?? status;
    const nextPage = params.page ?? 1;

    if (nextSearch) next.set("search", nextSearch);
    if (nextStatus && nextStatus !== "all") next.set("status", nextStatus);
    if (nextPage > 1) next.set("page", String(nextPage));

    router.push(`/dashboard/stores${next.toString() ? `?${next.toString()}` : ""}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ search: searchInput, page: 1 });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
        <form onSubmit={handleSearchSubmit} className="flex gap-2 flex-1 max-w-md">
          <Input
            placeholder="Search by name, domain, or email..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>

        <select
          value={status}
          onChange={(e) => navigate({ status: e.target.value, page: 1 })}
          className="h-10 rounded-md border border-input bg-background px-3 text-sm"
        >
          <option value="all">All stores</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Shop Name</TableHead>
              <TableHead>Domain</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Installed</TableHead>
              <TableHead>Last Synced</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                  No stores found.
                </TableCell>
              </TableRow>
            ) : (
              stores.map((store) => (
                <TableRow key={store.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/stores/${store.shopDomain}`}
                      className="hover:underline"
                    >
                      {store.shopName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{store.shopDomain}</TableCell>
                  <TableCell className="text-muted-foreground">{store.email}</TableCell>
                  <TableCell className="text-muted-foreground">{store.country || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={store.isActive ? "success" : "destructive"}>
                      {store.isActive ? "Active" : "Inactive"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatDate(store.installedAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {formatDate(store.lastSyncedAt)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <p>
          {total === 0
            ? "0 stores"
            : `Showing page ${page} of ${totalPages} (${total} total store${total === 1 ? "" : "s"})`}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => navigate({ page: page - 1 })}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => navigate({ page: page + 1 })}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
