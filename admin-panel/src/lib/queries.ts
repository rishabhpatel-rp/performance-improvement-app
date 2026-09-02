import { prisma } from "./prisma";
import { showDummyData } from "./data-source";
import {
  getDummyDashboardStats,
  getDummyStores,
  getDummyStoreByDomain,
} from "./dummy-data";
import type { DashboardStats, StoresResult, StoreWithDetails } from "./types";

interface StoreWhereInput {
  isActive?: boolean;
  OR?: Array<{
    shopName?: { contains: string; mode: "insensitive" };
    shopDomain?: { contains: string; mode: "insensitive" };
    email?: { contains: string; mode: "insensitive" };
  }>;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  if (showDummyData) return getDummyDashboardStats();

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalStores,
    activeStores,
    inactiveStores,
    recentlyInstalledCount,
    recentInstalls,
    recentActivity,
  ] = await Promise.all([
    prisma.store.count(),
    prisma.store.count({ where: { isActive: true } }),
    prisma.store.count({ where: { isActive: false } }),
    prisma.store.count({ where: { installedAt: { gte: sevenDaysAgo } } }),
    prisma.store.findMany({
      orderBy: { installedAt: "desc" },
      take: 10,
      select: {
        id: true,
        shopName: true,
        shopDomain: true,
        installedAt: true,
        isActive: true,
        country: true,
      },
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

  return {
    totalStores,
    activeStores,
    inactiveStores,
    recentlyInstalledCount,
    recentInstalls,
    recentActivity,
  };
}

export async function getStores(options?: {
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}): Promise<StoresResult> {
  if (showDummyData) return getDummyStores(options);

  const page = options?.page && options.page > 0 ? options.page : 1;
  const pageSize = options?.pageSize || 20;
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

export async function getStoreByDomain(
  domain: string,
): Promise<StoreWithDetails | null> {
  if (showDummyData) return getDummyStoreByDomain(domain);

  return prisma.store.findUnique({
    where: { shopDomain: domain },
    include: {
      configs: true,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });
}

export type { DashboardStats, StoresResult, StoreWithDetails };
