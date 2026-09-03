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
  OR?: Array<{
    shopName?: { contains: string; mode: "insensitive" };
    shopDomain?: { contains: string; mode: "insensitive" };
    email?: { contains: string; mode: "insensitive" };
  }>;
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
      include: { configs: true },
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
  const inactiveStores = union.filter((s) => !s.isActive).length;
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
    s.configs.some((c) => (c as { auditComplete?: boolean }).auditComplete),
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
    inactiveStores,
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
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<StoresResult> {
  const demoMode = await getDemoMode();

  const page = options?.page && options.page > 0 ? options.page : 1;
  const pageSize = options?.pageSize || 20;

  if (demoMode !== "on") {
    const skip = (page - 1) * pageSize;
    const where: StoreWhereInput = {};
    if (options?.isActive !== undefined) where.isActive = options.isActive;
    if (options?.search) {
      where.OR = [
        { shopName: { contains: options.search, mode: "insensitive" } },
        { shopDomain: { contains: options.search, mode: "insensitive" } },
        { email: { contains: options.search, mode: "insensitive" } },
      ];
    }

    const [stores, total] = await Promise.all([
      prisma.store.findMany({
        where,
        include: { configs: true },
        orderBy: { installedAt: "desc" },
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
  // filters + pagination to the combined in-memory list.
  const [realStores, dummyStores] = await Promise.all([
    prisma.store.findMany({
      include: { configs: true },
      orderBy: { installedAt: "desc" },
    }),
    Promise.resolve(getAllDummyStores()),
  ]);

  let combined: StoreWithConfigs[] = [...realStores, ...dummyStores];

  if (options?.isActive !== undefined) {
    combined = combined.filter((s) => s.isActive === options.isActive);
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

  combined.sort((a, b) => b.installedAt.getTime() - a.installedAt.getTime());

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
