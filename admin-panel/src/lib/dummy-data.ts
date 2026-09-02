// Hard-coded dummy data used when SHOW_DUMMY_DATA=true so the admin panel
// can be reviewed without a populated database. Remove this file (and the
// SHOW_DUMMY_DATA handling in queries.ts) before go-live.

import type { DashboardStats, StoresResult, StoreWithDetails } from "./types";

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

const dummyConfig = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: "cfg_1",
  storeId: "store_1",
  appEnabled: true,
  script1Enabled: true,
  script2Enabled: true,
  script3Enabled: false,
  debugMode: false,
  scriptTitles: ["Dummy Script 1", "Dummy Script 2", "Dummy Style"],
  metaobjectId: "gid://shopify/Metaobject/123456",
  createdAt: new Date(now - 30 * day),
  updatedAt: new Date(now - 1 * day),
  ...overrides,
});

const dummyStores = [
  {
    id: "store_1",
    shopifyShopId: "1001",
    shopDomain: "aurora-apparel.myshopify.com",
    shopName: "Aurora Apparel",
    email: "owner@aurora-apparel.com",
    country: "US",
    countryName: "United States",
    city: "Austin",
    address1: "100 Main St",
    address2: "",
    zip: "78701",
    timezone: "(GMT-05:00) Central Time",
    ianaTimezone: "America/Chicago",
    currency: "USD",
    locale: "en",
    shopifyPlan: "Shopify Plus",
    totalProducts: 1240,
    totalOrders: 48210,
    createdAtShopify: new Date(now - 900 * day),
    installedAt: new Date(now - 6 * day),
    uninstalledAt: null,
    isActive: true,
    currentScope: "read_products,write_products,read_orders",
    lastSyncedAt: new Date(now - 1 * day),
    createdAt: new Date(now - 6 * day),
    updatedAt: new Date(now - 1 * day),
    configs: [dummyConfig()],
    activities: [
      {
        id: "act_1",
        storeId: "store_1",
        eventType: "config_updated",
        description: "Enabled script 2 and updated script titles",
        metadata: { scripts: ["script1", "script2"] },
        createdAt: new Date(now - 2 * day),
        store: { shopName: "Aurora Apparel", shopDomain: "aurora-apparel.myshopify.com" },
      },
      {
        id: "act_2",
        storeId: "store_1",
        eventType: "config_updated",
        description: "Toggled script 3 (style) on the storefront",
        metadata: { scripts: ["script3"] },
        createdAt: new Date(now - 5 * day),
        store: { shopName: "Aurora Apparel", shopDomain: "aurora-apparel.myshopify.com" },
      },
    ],
  },
  {
    id: "store_2",
    shopifyShopId: "1002",
    shopDomain: "northwind-coffee.myshopify.com",
    shopName: "Northwind Coffee",
    email: "hi@northwind-coffee.com",
    country: "GB",
    countryName: "United Kingdom",
    city: "London",
    address1: "12 Britannia St",
    address2: "",
    zip: "EC1A 1BB",
    timezone: "(GMT+00:00) London",
    ianaTimezone: "Europe/London",
    currency: "GBP",
    locale: "en",
    shopifyPlan: "Basic Shopify",
    totalProducts: 210,
    totalOrders: 8930,
    createdAtShopify: new Date(now - 400 * day),
    installedAt: new Date(now - 12 * day),
    uninstalledAt: null,
    isActive: true,
    currentScope: "read_products,read_orders",
    lastSyncedAt: new Date(now - 3 * day),
    createdAt: new Date(now - 12 * day),
    updatedAt: new Date(now - 3 * day),
    configs: [
      dummyConfig({
        appEnabled: true,
        script2Enabled: false,
        script3Enabled: true,
      }),
    ],
    activities: [
      {
        id: "act_3",
        storeId: "store_2",
        eventType: "installed",
        description: "App installed",
        metadata: null,
        createdAt: new Date(now - 12 * day),
        store: { shopName: "Northwind Coffee", shopDomain: "northwind-coffee.myshopify.com" },
      },
    ],
  },
  {
    id: "store_3",
    shopifyShopId: "1003",
    shopDomain: "pebble-toys.myshopify.com",
    shopName: "Pebble Toys",
    email: "contact@pebble-toys.com",
    country: "CA",
    countryName: "Canada",
    city: "Vancouver",
    address1: "77 Harbour Rd",
    address2: "",
    zip: "V6B 1A1",
    timezone: "(GMT-08:00) Pacific Time",
    ianaTimezone: "America/Vancouver",
    currency: "CAD",
    locale: "en",
    shopifyPlan: "Basic Shopify",
    totalProducts: 540,
    totalOrders: 15200,
    createdAtShopify: new Date(now - 600 * day),
    installedAt: new Date(now - 60 * day),
    uninstalledAt: new Date(now - 30 * day),
    isActive: false,
    currentScope: "read_products,read_orders",
    lastSyncedAt: new Date(now - 30 * day),
    createdAt: new Date(now - 60 * day),
    updatedAt: new Date(now - 30 * day),
    configs: [dummyConfig({ appEnabled: false })],
    activities: [
      {
        id: "act_4",
        storeId: "store_3",
        eventType: "uninstalled",
        description: "App uninstalled",
        metadata: null,
        createdAt: new Date(now - 30 * day),
        store: { shopName: "Pebble Toys", shopDomain: "pebble-toys.myshopify.com" },
      },
    ],
  },
];

export function getDummyDashboardStats(): DashboardStats {
  const stores = dummyStores;
  const sevenDaysAgo = new Date(now - 7 * day);

  const recentInstalls = stores
    .filter((s) => s.installedAt.getTime() >= sevenDaysAgo.getTime())
    .map((s) => ({
      id: s.id,
      shopName: s.shopName,
      shopDomain: s.shopDomain,
      installedAt: s.installedAt,
      isActive: s.isActive,
      country: s.country,
    }));

  const recentActivity = stores
    .flatMap((s) => s.activities.map((a) => ({ ...a, store: a.store ?? null })))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 20);

  return {
    totalStores: stores.length,
    activeStores: stores.filter((s) => s.isActive).length,
    inactiveStores: stores.filter((s) => !s.isActive).length,
    recentlyInstalledCount: recentInstalls.length,
    recentInstalls,
    recentActivity,
  };
}

export function getDummyStores(options?: {
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}): StoresResult {
  const page = options?.page && options.page > 0 ? options.page : 1;
  const pageSize = options?.pageSize || 20;

  let filtered = [...dummyStores];

  if (options?.isActive !== undefined) {
    filtered = filtered.filter((s) => s.isActive === options.isActive);
  }

  if (options?.search) {
    const q = options.search.toLowerCase();
    filtered = filtered.filter(
      (s) =>
        s.shopName.toLowerCase().includes(q) ||
        s.shopDomain.toLowerCase().includes(q) ||
        s.email.toLowerCase().includes(q),
    );
  }

  const skip = (page - 1) * pageSize;
  const stores = filtered.slice(skip, skip + pageSize).map((s) => ({ ...s, configs: s.configs }));

  return {
    stores,
    total: filtered.length,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  };
}

export function getDummyStoreByDomain(domain: string): NonNullable<StoreWithDetails> | null {
  const store = dummyStores.find((s) => s.shopDomain === domain);
  if (!store) return null;
  return {
    ...store,
    configs: store.configs,
    activities: store.activities,
  };
}
