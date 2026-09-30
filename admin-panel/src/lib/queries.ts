import { prisma } from "./prisma";
import { getDemoMode } from "./demo-mode";
import {
  getAllDummyStores,
  getDummyStoreByDomain,
  DUMMY_ACTIVITIES,
  buildInstallsByDay,
  buildCountByKey,
} from "./dummy-data";
import type {
  DashboardStats,
  StoresResult,
  StoreWithDetails,
  StoreWithConfigs,
  NewStoreRow,
  StoreActivity,
} from "./types";

interface StoreWhereInput {
  isActive?: boolean;
  configs?: { some: { appEnabled: boolean } };
  OR?: Array<{
    shopName?: { contains: string; mode: "insensitive" };
    shopDomain?: { contains: string; mode: "insensitive" };
    email?: { contains: string; mode: "insensitive" };
  }>;
}

/**
 * Explicit allowlist for the related StoreConfig row.
 *
 * NEVER use `include: { configs: { select: STORE_CONFIG_SELECT } }` here. That selects all 42
 * StoreConfig columns, including `storefrontPassword` — the merchant's own
 * storefront password — which was then serialised into the RSC flight payload
 * delivered to the browser on every store-detail view. Select only what the UI
 * actually reads.
 */
const STORE_CONFIG_SELECT = {
  appEnabled: true,
  script1Enabled: true,
  script2Enabled: true,
  script3Enabled: true,
  debugMode: true,
  scriptTitles: true,
  metaobjectId: true,
  auditComplete: true,
  updatedAt: true,
} as const;

const SORTABLE_FIELDS = [
  "shopName",
  "shopDomain",
  "email",
  "country",
  "isActive",
  "installedAt",
  "lastSyncedAt",
  // Not a real Store column — lives on the related (one-to-many) StoreConfig
  // table, so it can't go through Prisma's `orderBy` and is always sorted
  // in memory (see the `sortField === "appEnabled"` branch in getStores).
  "appEnabled",
] as const;

export type StoreSortField = (typeof SORTABLE_FIELDS)[number];
export type SortDirection = "asc" | "desc";

function normalizeSort(
  sortBy?: string,
  sortDir?: string,
): { field: StoreSortField; dir: SortDirection } {
  const field = (SORTABLE_FIELDS as readonly string[]).includes(sortBy ?? "")
    ? (sortBy as StoreSortField)
    : "installedAt";
  const dir: SortDirection = sortDir === "asc" ? "asc" : "desc";
  return { field, dir };
}

function compareStores(a: StoreWithConfigs, b: StoreWithConfigs, field: StoreSortField): number {
  if (field === "appEnabled") {
    return Number(a.configs[0]?.appEnabled ?? false) - Number(b.configs[0]?.appEnabled ?? false);
  }
  const av = a[field];
  const bv = b[field];
  if (av == null && bv == null) return 0;
  if (av == null) return -1;
  if (bv == null) return 1;
  if (av instanceof Date && bv instanceof Date) return av.getTime() - bv.getTime();
  if (typeof av === "boolean" && typeof bv === "boolean") return Number(av) - Number(bv);
  return String(av).toLowerCase().localeCompare(String(bv).toLowerCase());
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export async function getDashboardStats(): Promise<DashboardStats> {
  const demoMode = await getDemoMode();
  const sevenDaysAgo = new Date(Date.now() - SEVEN_DAYS_MS);
  const thirtyDaysAgo = new Date(Date.now() - THIRTY_DAYS_MS);

  // Pull everything needed to compute both the existing counts and the new
  // analytics aggregates from the real database.
  const [allRealStores, recentActivityReal] = await Promise.all([
    prisma.store.findMany({
      include: { configs: { select: STORE_CONFIG_SELECT } },
      orderBy: { installedAt: "desc" },
    }),
    prisma.storeActivity.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: {
        store: {
          select: { shopName: true, shopDomain: true },
        },
      },
    }),
  ]);

  const dummyStores = demoMode === "on" ? getAllDummyStores() : [];

  // `union` merges real + dummy store rows in memory only. Dummy rows are
  // never written back to the database (see dummy-data.ts).
  const union: StoreWithConfigs[] = [...allRealStores, ...dummyStores];

  const totalStores = union.length;
  const activeStores = union.filter((s) => s.isActive).length;
  const appOnStores = union.filter((s) => s.configs[0]?.appEnabled).length;
  const recentlyInstalledCount = union.filter(
    (s) => s.installedAt.getTime() >= sevenDaysAgo.getTime(),
  ).length;

  const recentInstalls: NewStoreRow[] = [...union]
    .sort((a, b) => b.installedAt.getTime() - a.installedAt.getTime())
    .slice(0, 10)
    .map((s) => ({
      id: s.id,
      shopName: s.shopName,
      shopDomain: s.shopDomain,
      installedAt: s.installedAt,
      isActive: s.isActive,
      country: s.country,
    }));

  const recentActivity: StoreActivity[] =
    demoMode === "on"
      ? [...recentActivityReal, ...DUMMY_ACTIVITIES]
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
          .slice(0, 20)
      : recentActivityReal;

  const totalProducts = union.reduce((sum, s) => sum + (s.totalProducts ?? 0), 0);
  const totalOrders = union.reduce((sum, s) => sum + (s.totalOrders ?? 0), 0);
  const auditsCompleted = union.filter((s) =>
    s.configs.some((c) => c.auditComplete),
  ).length;

  const installsByDay = buildInstallsByDay(
    union.map((s) => s.installedAt),
    thirtyDaysAgo,
  );

  const storesByCountry = buildCountByKey(
    union,
    (s) => s.countryName ?? s.country ?? "Unknown",
  )
    .map(({ key, count }) => ({ country: key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const storesByPlan = buildCountByKey(union, (s) => s.shopifyPlan ?? "Unknown").map(
    ({ key, count }) => ({ plan: key, count }),
  );

  return {
    totalStores,
    activeStores,
    appOnStores,
    recentlyInstalledCount,
    recentInstalls,
    recentActivity,
    totalProducts,
    totalOrders,
    auditsCompleted,
    installsByDay,
    storesByCountry,
    storesByPlan,
  };
}

export async function getStores(options?: {
  isActive?: boolean;
  appEnabled?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDir?: string;
}): Promise<StoresResult> {
  const demoMode = await getDemoMode();

  const page = options?.page && options.page > 0 ? options.page : 1;
  const pageSize = options?.pageSize || 20;
  const { field: sortField, dir: sortDir } = normalizeSort(options?.sortBy, options?.sortDir);

  if (demoMode !== "on") {
    const where: StoreWhereInput = {};
    if (options?.isActive !== undefined) where.isActive = options.isActive;
    if (options?.appEnabled !== undefined) {
      where.configs = { some: { appEnabled: options.appEnabled } };
    }
    if (options?.search) {
      where.OR = [
        { shopName: { contains: options.search, mode: "insensitive" } },
        { shopDomain: { contains: options.search, mode: "insensitive" } },
        { email: { contains: options.search, mode: "insensitive" } },
      ];
    }

    // "appEnabled" lives on the related StoreConfig table, not on Store, so
    // Prisma can't order by it directly — fetch every matching row, sort in
    // memory, then paginate there instead of at the DB level.
    if (sortField === "appEnabled") {
      const [allStores, total] = await Promise.all([
        prisma.store.findMany({ where, include: { configs: { select: STORE_CONFIG_SELECT } } }),
        prisma.store.count({ where }),
      ]);
      allStores.sort((a, b) => {
        const cmp = compareStores(a, b, sortField);
        return sortDir === "asc" ? cmp : -cmp;
      });
      const skip = (page - 1) * pageSize;
      return {
        stores: allStores.slice(skip, skip + pageSize),
        total,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
      };
    }

    const skip = (page - 1) * pageSize;
    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        include: { configs: { select: STORE_CONFIG_SELECT } },
        orderBy: { [sortField]: sortDir },
        take: pageSize,
        skip,
      }),
      prisma.store.count({ where }),
    ]);

    return {
      stores,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // Demo mode ON: combine real rows and dummy rows, then apply the same
  // filters + pagination to the combined in-memory list. The initial fetch
  // order doesn't matter here — everything gets re-sorted by `sortField`
  // below once real and dummy rows are combined.
  const [realStores, dummyStores] = await Promise.all([
    prisma.store.findMany({
      include: { configs: { select: STORE_CONFIG_SELECT } },
      orderBy: { installedAt: "desc" },
    }),
    Promise.resolve(getAllDummyStores()),
  ]);

  let combined: StoreWithConfigs[] = [...realStores, ...dummyStores];

  if (options?.isActive !== undefined) {
    combined = combined.filter((s) => s.isActive === options.isActive);
  }
  if (options?.appEnabled !== undefined) {
    combined = combined.filter(
      (s) => (s.configs[0]?.appEnabled ?? false) === options.appEnabled,
    );
  }
  if (options?.search) {
    const q = options.search.toLowerCase();
    combined = combined.filter(
      (s) =>
        s.shopName.toLowerCase().includes(q) ||
        s.shopDomain.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q),
    );
  }

  combined.sort((a, b) => {
    const cmp = compareStores(a, b, sortField);
    return sortDir === "asc" ? cmp : -cmp;
  });

  const total = combined.length;
  const skip = (page - 1) * pageSize;
  const stores = combined.slice(skip, skip + pageSize);

  return {
    stores,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

export async function getStoreByDomain(
  domain: string,
): Promise<StoreWithDetails | null> {
  const demoMode = await getDemoMode();

  const real = await prisma.store.findUnique({
    where: { shopDomain: domain },
    include: {
      configs: true,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });

  if (real) return real;

  if (demoMode === "on") {
    return getDummyStoreByDomain(domain);
  }

  return null;
}

export type { DashboardStats, StoresResult, StoreWithDetails };
