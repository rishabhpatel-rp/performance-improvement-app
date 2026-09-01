import prisma from "../db.server";

// ============================================================
// Type definitions
// ============================================================
interface ShopifyShopData {
  shopifyShopId: string;
  shopDomain: string;
  shopName: string;
  email: string;
  country?: string;
  countryName?: string;
  city?: string;
  address1?: string;
  address2?: string;
  zip?: string;
  timezone?: string;
  ianaTimezone?: string;
  currency?: string;
  locale?: string;
  shopifyPlan?: string;
  totalProducts?: number;
  totalOrders?: number;
  createdAtShopify?: Date;
  currentScope?: string;
}

interface SyncConfigInput {
  appEnabled: boolean;
  script1Enabled: boolean;
  script2Enabled: boolean;
  script3Enabled: boolean;
  debugMode: boolean;
  auditComplete: boolean;
  scriptTitles: string[];
  auditDeferArray: string[];
  auditHideSelectors: string[];
  metaobjectId?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

// ============================================================
// FUNCTION 1: Fetch shop details from Shopify Admin API
// ============================================================

export async function fetchShopDetailsFromShopify(
  admin: AdminClient,
): Promise<ShopifyShopData> {
  const response = await admin.graphql(
    `#graphql
    query ShopDetails {
      shop {
        name
        email
        url
        myshopifyDomain
        shopAddress {
          country
          countryCode
          city
          address1
          address2
          zip
        }
        ianaTimezone
        timezoneAbbreviation
        currencyCode
        plan {
          displayName
        }
        createdAt
        updatedAt
      }
      productsCount {
        count
      }
      ordersCount {
        count
      }
    }`,
  );

  const data = await response.json();
  const shop = data.data?.shop;
  const productsCount = data.data?.productsCount?.count;
  const ordersCount = data.data?.ordersCount?.count;

  if (!shop) {
    throw new Error("Failed to fetch shop details from Shopify");
  }

  const shopDomain = shop.myshopifyDomain || "";

  return {
    shopifyShopId: shopDomain,
    shopDomain: shopDomain,
    shopName: shop.name || "",
    email: shop.email || "",
    country: shop.shopAddress?.countryCode || undefined,
    countryName: shop.shopAddress?.country || undefined,
    city: shop.shopAddress?.city || undefined,
    address1: shop.shopAddress?.address1 || undefined,
    address2: shop.shopAddress?.address2 || undefined,
    zip: shop.shopAddress?.zip || undefined,
    timezone: shop.timezoneAbbreviation || undefined,
    ianaTimezone: shop.ianaTimezone || undefined,
    currency: shop.currencyCode || undefined,
    shopifyPlan: shop.plan?.displayName || undefined,
    totalProducts: productsCount ?? undefined,
    totalOrders: ordersCount ?? undefined,
    createdAtShopify: shop.createdAt ? new Date(shop.createdAt) : undefined,
  };
}

// ============================================================
// FUNCTION 2: Create or update a store record (upsert)
// ============================================================

export async function upsertStore(data: ShopifyShopData) {
  return prisma.store.upsert({
    where: { shopDomain: data.shopDomain },
    create: {
      shopifyShopId: data.shopifyShopId,
      shopDomain: data.shopDomain,
      shopName: data.shopName,
      email: data.email,
      country: data.country,
      countryName: data.countryName,
      city: data.city,
      address1: data.address1,
      address2: data.address2,
      zip: data.zip,
      timezone: data.timezone,
      ianaTimezone: data.ianaTimezone,
      currency: data.currency,
      shopifyPlan: data.shopifyPlan,
      totalProducts: data.totalProducts,
      totalOrders: data.totalOrders,
      createdAtShopify: data.createdAtShopify,
      currentScope: data.currentScope,
      lastSyncedAt: new Date(),
    },
    update: {
      shopName: data.shopName,
      email: data.email,
      country: data.country,
      countryName: data.countryName,
      city: data.city,
      address1: data.address1,
      address2: data.address2,
      zip: data.zip,
      timezone: data.timezone,
      ianaTimezone: data.ianaTimezone,
      currency: data.currency,
      shopifyPlan: data.shopifyPlan,
      totalProducts: data.totalProducts,
      totalOrders: data.totalOrders,
      createdAtShopify: data.createdAtShopify,
      currentScope: data.currentScope,
      lastSyncedAt: new Date(),
    },
  });
}

// ============================================================
// FUNCTION 3: Mark a store as uninstalled
// ============================================================

export async function markStoreUninstalled(shopDomain: string) {
  return prisma.store.updateMany({
    where: { shopDomain },
    data: {
      uninstalledAt: new Date(),
      isActive: false,
    },
  });
}

// ============================================================
// FUNCTION 4: Update store scope
// ============================================================

export async function updateStoreScope(shopDomain: string, newScope: string) {
  return prisma.store.updateMany({
    where: { shopDomain },
    data: { currentScope: newScope },
  });
}

// ============================================================
// FUNCTION 5: Sync config from metaobject to database
// ============================================================

export async function syncConfigToDatabase(
  shopDomain: string,
  config: SyncConfigInput,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    console.warn(
      `[syncConfigToDatabase] No store found for ${shopDomain}. ` +
        `Config sync skipped.`,
    );
    return null;
  }

  const storeConfig = await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      appEnabled: config.appEnabled,
      script1Enabled: config.script1Enabled,
      script2Enabled: config.script2Enabled,
      script3Enabled: config.script3Enabled,
      debugMode: config.debugMode,
      auditComplete: config.auditComplete,
      scriptTitles: config.scriptTitles,
      auditDeferArray: config.auditDeferArray,
      auditHideSelectors: config.auditHideSelectors,
      metaobjectId: config.metaobjectId,
    },
    update: {
      appEnabled: config.appEnabled,
      script1Enabled: config.script1Enabled,
      script2Enabled: config.script2Enabled,
      script3Enabled: config.script3Enabled,
      debugMode: config.debugMode,
      auditComplete: config.auditComplete,
      scriptTitles: config.scriptTitles,
      auditDeferArray: config.auditDeferArray,
      auditHideSelectors: config.auditHideSelectors,
      metaobjectId: config.metaobjectId,
    },
  });

  await prisma.store.update({
    where: { id: store.id },
    data: { lastSyncedAt: new Date() },
  });

  return storeConfig;
}

// ============================================================
// FUNCTION 6: Log an activity event
// ============================================================

export async function logActivity(
  shopDomain: string,
  eventType: string,
  description?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: Record<string, any>,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    console.warn(
      `[logActivity] No store found for ${shopDomain}. Activity not logged.`,
    );
    return null;
  }

  return prisma.storeActivity.create({
    data: {
      storeId: store.id,
      eventType,
      description,
      metadata: metadata || undefined,
    },
  });
}

// ============================================================
// FUNCTION 7: Get a store with all relations
// ============================================================

export async function getStoreWithDetails(shopDomain: string) {
  return prisma.store.findUnique({
    where: { shopDomain },
    include: {
      configs: true,
      activities: {
        orderBy: { createdAt: "desc" },
        take: 100,
      },
    },
  });
}

// ============================================================
// FUNCTION 8: Get all stores (for admin panel list)
// ============================================================

export async function getAllStores(options?: {
  isActive?: boolean;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  if (options?.isActive !== undefined) {
    where.isActive = options.isActive;
  }

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
      take: options?.limit || 50,
      skip: options?.offset || 0,
    }),
    prisma.store.count({ where }),
  ]);

  return { stores, total };
}

// ============================================================
// FUNCTION 9: Get dashboard stats
// ============================================================

export async function getDashboardStats() {
  const [totalStores, activeStores, inactiveStores, recentInstalls, recentActivity] =
    await Promise.all([
      prisma.store.count(),
      prisma.store.count({ where: { isActive: true } }),
      prisma.store.count({ where: { isActive: false } }),
      prisma.store.findMany({
        orderBy: { installedAt: "desc" },
        take: 10,
        select: {
          id: true,
          shopName: true,
          shopDomain: true,
          installedAt: true,
          isActive: true,
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
    recentInstalls,
    recentActivity,
  };
}
