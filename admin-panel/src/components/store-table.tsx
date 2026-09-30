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
  appEnabledFilter: string;
  sortBy: string;
  sortDir: "asc" | "desc";
}

const SORTABLE_COLUMNS: { key: string; label: string }[] = [
  { key: "shopName", label: "Shop Name" },
  { key: "shopDomain", label: "Domain" },
  { key: "email", label: "Email" },
  { key: "country", label: "Country" },
  { key: "isActive", label: "Status" },
  { key: "installedAt", label: "Installed" },
  { key: "lastSyncedAt", label: "Last Synced" },
  { key: "appEnabled", label: "App Enabled" },
];

export default function StoreTable({
  stores,
  total,
  page,
  totalPages,
  search,
  status,
  appEnabledFilter,
  sortBy,
  sortDir,
}: StoreTableProps) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState(search);

  const navigate = (params: {
    search?: string;
    status?: string;
    appEnabledFilter?: string;
    page?: number;
    sortBy?: string;
    sortDir?: string;
  }) => {
    const next = new URLSearchParams();
    const nextSearch = params.search ?? search;
    const nextStatus = params.status ?? status;
    const nextAppEnabled = params.appEnabledFilter ?? appEnabledFilter;
    const nextPage = params.page ?? 1;
    const nextSortBy = params.sortBy ?? sortBy;
    const nextSortDir = params.sortDir ?? sortDir;

    if (nextSearch) next.set("search", nextSearch);
    if (nextStatus && nextStatus !== "all") next.set("status", nextStatus);
    if (nextAppEnabled && nextAppEnabled !== "all") next.set("appEnabled", nextAppEnabled);
    if (nextPage > 1) next.set("page", String(nextPage));
    if (nextSortBy && nextSortBy !== "installedAt") next.set("sortBy", nextSortBy);
    if (nextSortDir && nextSortDir !== "desc") next.set("sortDir", nextSortDir);

    router.push(`/dashboard/stores${next.toString() ? `?${next.toString()}` : ""}`);
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate({ search: searchInput, page: 1 });
  };

  const handleSort = (key: string) => {
    const nextDir = sortBy === key && sortDir === "asc" ? "desc" : "asc";
    navigate({ sortBy: key, sortDir: nextDir, page: 1 });
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
          <option value="active">Installed</option>
          <option value="inactive">Uninstalled</option>
        </select>
      </div>

      <div className="rounded-lg border border-border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              {SORTABLE_COLUMNS.map((col) => (
                <TableHead key={col.key}>
                  <button
                    type="button"
                    onClick={() => handleSort(col.key)}
                    className="flex items-center gap-1 hover:text-foreground"
                  >
                    {col.label}
                    <span className="text-xs text-muted-foreground/70">
                      {sortBy === col.key ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                    </span>
                  </button>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {stores.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                  No stores found.
                </TableCell>
              </TableRow>
            ) : (
              stores.map((store) => {
                const appEnabled = store.configs[0]?.appEnabled ?? false;
                return (
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
                        {store.isActive ? "Installed" : "Uninstalled"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(store.installedAt)}
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {formatDate(store.lastSyncedAt)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={appEnabled ? "success" : "destructive"}>
                        {appEnabled ? "On" : "Off"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
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
