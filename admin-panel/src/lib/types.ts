// Shared data shapes for the admin panel. Both the database-backed queries
// (lib/queries.ts) and the dummy-data source (lib/dummy-data.ts) resolve to
// these structural types, and the UI components are typed against them.

/**
 * Mirrors STORE_CONFIG_SELECT in queries.ts — the ONLY StoreConfig columns the
 * admin panel reads. Deliberately not the full 42-column row: selecting (and
 * therefore serialising) everything once shipped the merchant's
 * `storefrontPassword` into the RSC payload sent to the browser.
 */
export interface StoreConfig {
  appEnabled: boolean;
  script1Enabled: boolean;
  script2Enabled: boolean;
  script3Enabled: boolean;
  debugMode: boolean;
  scriptTitles: unknown;
  metaobjectId: string | null;
  updatedAt: Date;
  auditComplete?: boolean;
}

export interface StoreSummary {
  id: string;
  shopifyShopId: string;
  shopDomain: string;
  shopName: string;
  email: string;
  country: string | null;
  countryName: string | null;
  city: string | null;
  address1: string | null;
  address2: string | null;
  zip: string | null;
  timezone: string | null;
  ianaTimezone: string | null;
  currency: string | null;
  locale: string | null;
  shopifyPlan: string | null;
  totalProducts: number | null;
  totalOrders: number | null;
  createdAtShopify: Date | null;
  installedAt: Date;
  uninstalledAt: Date | null;
  isActive: boolean;
  currentScope: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewStoreRow {
  id: string;
  shopName: string;
  shopDomain: string;
  installedAt: Date;
  isActive: boolean;
  country: string | null;
}

export interface StoreActivity {
  id: string;
  storeId: string;
  eventType: string;
  description: string | null;
  metadata: unknown;
  createdAt: Date;
  store?: { shopName: string; shopDomain: string } | null;
}

export interface StoreWithConfigs extends StoreSummary {
  configs: StoreConfig[];
}

export interface StoreWithDetails extends StoreWithConfigs {
  activities: StoreActivity[];
}

export interface InstallsByDayPoint {
  date: string; // YYYY-MM-DD
  count: number;
}

export interface CountryCount {
  country: string;
  count: number;
}

export interface PlanCount {
  plan: string;
  count: number;
}

export interface DashboardStats {
  totalStores: number;
  activeStores: number;
  appOnStores: number;
  recentlyInstalledCount: number;
  recentInstalls: NewStoreRow[];
  recentActivity: StoreActivity[];
  totalProducts: number;
  totalOrders: number;
  auditsCompleted: number;
  installsByDay: InstallsByDayPoint[];
  storesByCountry: CountryCount[];
  storesByPlan: PlanCount[];
}

export interface StoresResult {
  stores: StoreWithConfigs[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}
