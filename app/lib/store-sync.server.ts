import prisma from "../db.server";
import {
  rebuildPerformanceScript,
  readStringArray,
} from "./performance-script.server";

import type { AuditPageInfo } from "./audit.server";

export { readStringArray };

/**
 * Safely coerce the `StoreConfig.auditPages` Json column (written by
 * `describePages()`) into `[{ label, path }]`. Returns `[]` when the value is
 * not an array, and drops any entry that is not an object with string `label`
 * and `path` — never trusts the raw `JsonValue` from the DB.
 */
export function readAuditPages(value: unknown): AuditPageInfo[] {
  if (!Array.isArray(value)) return [];
  const pages: AuditPageInfo[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const { label, path } = item as { label?: unknown; path?: unknown };
      if (typeof label === "string" && typeof path === "string") {
        pages.push({ label, path });
      }
    }
  }
  return pages;
}

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
  scriptTitles: string[];
  metaobjectId?: string;
  auditComplete?: boolean;
  auditDeferArray?: string[];
  auditHideSelectors?: string[];
  staticDeferDefaults?: string[];
  auditDeferArrayEnabled?: boolean;
  auditHideSelectorsEnabled?: boolean;
  staticDeferDefaultsEnabled?: boolean;
  auditDeferArrayPreserved?: string[];
  auditHideSelectorsPreserved?: string[];
  staticDeferDefaultsPreserved?: string[];

  // NEW
  firstUserDelayScripts?: string[];
  firstUserDelayScriptsEnabled?: boolean;
  firstUserDelayScriptsPreserved?: string[];
  firstUserDelayMs?: number;
  everyTimeDelayMs?: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

// Static defaults the app always defers, independent of the audit results.
// Stored DB-only (not on the metaobject) and editable per store in Step 3.
export const DEFAULT_STATIC_DEFER = ["wpm","gtm"];

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
        id
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
    // Real Shopify numeric shop id (e.g. "gid://shopify/Shop/12345"), not
    // the domain — the domain is already tracked separately as shopDomain.
    shopifyShopId: shop.id || shopDomain,
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
    locale: shop.locale || undefined,
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
      locale: data.locale,
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
      locale: data.locale,
      shopifyPlan: data.shopifyPlan,
      totalProducts: data.totalProducts,
      totalOrders: data.totalOrders,
      createdAtShopify: data.createdAtShopify,
      currentScope: data.currentScope,
      lastSyncedAt: new Date(),
      // Reinstall: a returning shop must be active again so shop/redact
      // (48h after a prior uninstall) does not wipe the new install.
      isActive: true,
      uninstalledAt: null,
    },
  });
}

// ============================================================
// FUNCTION 3: Mark a store as uninstalled
// ============================================================

export async function markStoreUninstalled(shopDomain: string) {
  const result = await prisma.store.updateMany({
    where: { shopDomain },
    data: {
      uninstalledAt: new Date(),
      isActive: false,
    },
  });
  // Inactive store => empty script.
  await rebuildPerformanceScript(shopDomain);
  return result;
}

/**
 * Permanently erase all stored data for a shop (shop/redact).
 * Skips deletion when the shop has reinstalled and is active again.
 */
export async function eraseShopData(shopDomain: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { id: true, isActive: true },
  });

  if (store?.isActive) {
    console.log(
      `[shop/redact] Skip erase for ${shopDomain}: store is active (reinstalled)`,
    );
    return { skipped: true };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.$transaction(async (tx: any) => {
    await tx.session.deleteMany({ where: { shop: shopDomain } });
    await tx.appTracking.deleteMany({ where: { domain: shopDomain } });
    await tx.auditLog.deleteMany({ where: { domain: shopDomain } });

    if (store) {
      await tx.performanceScript.deleteMany({ where: { storeId: store.id } });
      await tx.storeActivity.deleteMany({ where: { storeId: store.id } });
      await tx.storeConfig.deleteMany({ where: { storeId: store.id } });
      await tx.store.delete({ where: { id: store.id } });
    }
  });

  return { skipped: false };
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
      scriptTitles: config.scriptTitles,
      metaobjectId: config.metaobjectId,
      auditComplete: config.auditComplete,
      auditDeferArray: config.auditDeferArray ?? [],
      auditHideSelectors: config.auditHideSelectors ?? [],
      staticDeferDefaults:
        config.staticDeferDefaults ?? DEFAULT_STATIC_DEFER,
      auditDeferArrayEnabled: config.auditDeferArrayEnabled ?? true,
      auditHideSelectorsEnabled: config.auditHideSelectorsEnabled ?? true,
      staticDeferDefaultsEnabled: config.staticDeferDefaultsEnabled ?? true,
      auditDeferArrayPreserved: config.auditDeferArrayPreserved ?? [],
      auditHideSelectorsPreserved: config.auditHideSelectorsPreserved ?? [],
      staticDeferDefaultsPreserved: config.staticDeferDefaultsPreserved ?? [],

      // NEW
      firstUserDelayScripts: config.firstUserDelayScripts ?? ["wpm","gtm"],
      firstUserDelayScriptsEnabled: config.firstUserDelayScriptsEnabled ?? true,
      firstUserDelayScriptsPreserved: config.firstUserDelayScriptsPreserved ?? [],
      firstUserDelayMs: config.firstUserDelayMs ?? 12000,
      everyTimeDelayMs: config.everyTimeDelayMs ?? 6000,
    },
    update: {
      appEnabled: config.appEnabled,
      script1Enabled: config.script1Enabled,
      script2Enabled: config.script2Enabled,
      script3Enabled: config.script3Enabled,
      debugMode: config.debugMode,
      scriptTitles: config.scriptTitles,
      metaobjectId: config.metaobjectId,
      // NOTE: audit-complete and the Step-3 arrays are DB-authoritative and
      // deliberately excluded from update. They are written only by
      // saveAuditReport() (the audit run) and updateAuditArrays() (Step-3
      // Save). Mirroring the (empty) metaobject values here on every dashboard
      // load would clobber the stored audit results and audit_complete flag.
      //

      // Toggle states + preserved snapshots are DB-only. They are kept in
      // sync with the active arrays here only during initial creation; the
      // active arrays remain DB-authoritative (written by saveAuditReport /
      // updateAuditArrays / updateAuditFieldToggle).
      auditDeferArrayEnabled: config.auditDeferArrayEnabled ?? undefined,
      auditHideSelectorsEnabled: config.auditHideSelectorsEnabled ?? undefined,
      staticDeferDefaultsEnabled: config.staticDeferDefaultsEnabled ?? undefined,
      auditDeferArrayPreserved: config.auditDeferArrayPreserved ?? undefined,
      auditHideSelectorsPreserved: config.auditHideSelectorsPreserved ?? undefined,
      staticDeferDefaultsPreserved: config.staticDeferDefaultsPreserved ?? undefined,

      // NEW
      firstUserDelayScriptsEnabled: config.firstUserDelayScriptsEnabled ?? undefined,
      firstUserDelayScriptsPreserved: config.firstUserDelayScriptsPreserved ?? undefined,
      firstUserDelayMs: config.firstUserDelayMs ?? undefined,
      everyTimeDelayMs: config.everyTimeDelayMs ?? undefined,
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

// ============================================================
// FUNCTION 10: Save a completed audit report + audit-log trail
// ============================================================

export interface AuditReport {
  deferArray: string[];
  hideSelectors: string[];
  pagesAudited: string[];
  completedAt: string;
}

export async function saveAuditReport(
  shopDomain: string,
  report: AuditReport,
  status = "completed",
  details?: string,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    console.warn(`[saveAuditReport] No store found for ${shopDomain}. Skipped.`);
    return null;
  }

  const completed = status === "completed";

  const current = await prisma.storeConfig.findUnique({
    where: { storeId: store.id },
  });
  const deferOn = current?.auditDeferArrayEnabled ?? true;
  const hideOn = current?.auditHideSelectorsEnabled ?? true;
  const activeDefer = deferOn ? report.deferArray : [];
  const activeHide = hideOn ? report.hideSelectors : [];

  // On success the audit stays "running" here: the flag flips to complete only
  // after the storefront script has been rebuilt and stored (below), so the
  // dashboard never reaches Step 2 before the script exists.
  const runState = completed
    ? {
        auditComplete: false,
        auditRunning: true,
        auditFailed: false,
        auditError: null,
      }
    : {
        auditComplete: false,
        auditRunning: false,
        auditFailed: true,
        auditError: details ?? null,
      };

  await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      appEnabled: false,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      ...runState,
      lastAuditAt: new Date(),
      auditDeferArray: activeDefer,
      auditHideSelectors: activeHide,
      auditDeferArrayPreserved: deferOn ? [] : report.deferArray,
      auditHideSelectorsPreserved: hideOn ? [] : report.hideSelectors,
      staticDeferDefaults: DEFAULT_STATIC_DEFER,
    },
    update: {
      ...runState,
      lastAuditAt: new Date(),
      auditDeferArray: activeDefer,
      auditHideSelectors: activeHide,
      auditDeferArrayPreserved: deferOn ? undefined : report.deferArray,
      auditHideSelectorsPreserved: hideOn ? undefined : report.hideSelectors,
    },
  });

  await prisma.auditLog.create({
    data: {
      domain: shopDomain,
      audit_type: "auto-audit",
      audit_data: report,
      status,
      details,
    },
  });

  await rebuildPerformanceScript(shopDomain);

  if (completed) {
    await prisma.storeConfig.update({
      where: { storeId: store.id },
      data: { auditComplete: true, auditRunning: false, auditPhase: null },
    });
  }

  return { ok: true };
}

export interface AuditArrayPatch {
  auditDeferArray?: string[];
  auditHideSelectors?: string[];
  staticDeferDefaults?: string[];
  firstUserDelayScripts?: string[];
  firstUserDelayMs?: number;
  everyTimeDelayMs?: number;
}

/**
 * DB-only writer for the three Step-3 audit/static arrays. This deliberately
 * bypasses the metaobject — these fields are DB-authoritative. Only the keys
 * actually provided are written (omitted keys keep their existing DB value),
 * so a single-field Save never clobbers the others. Creates the StoreConfig
 * row if missing, seeding the static defaults.
 */
export async function updateAuditArrays(
  shopDomain: string,
  patch: AuditArrayPatch,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });
  if (!store) {
    console.warn(
      `[updateAuditArrays] No store found for ${shopDomain}. Skipped.`,
    );
    return null;
  }

  const createData: AuditArrayPatch &
    Pick<AuditArrayPatch, "staticDeferDefaults"> = {
    auditDeferArray: patch.auditDeferArray ?? [],
    auditHideSelectors: patch.auditHideSelectors ?? [],
    staticDeferDefaults: patch.staticDeferDefaults ?? DEFAULT_STATIC_DEFER,
    firstUserDelayScripts: patch.firstUserDelayScripts ?? ["wpm","gtm"],
    firstUserDelayMs: patch.firstUserDelayMs ?? 12000,
    everyTimeDelayMs: patch.everyTimeDelayMs ?? 6000,
  };

  const result = await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      appEnabled: false,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      ...createData,
    },
    update: {
      ...(patch.auditDeferArray !== undefined
        ? { auditDeferArray: patch.auditDeferArray }
        : {}),
      ...(patch.auditHideSelectors !== undefined
        ? { auditHideSelectors: patch.auditHideSelectors }
        : {}),
      ...(patch.staticDeferDefaults !== undefined
        ? { staticDeferDefaults: patch.staticDeferDefaults }
        : {}),
      ...(patch.firstUserDelayScripts !== undefined
        ? { firstUserDelayScripts: patch.firstUserDelayScripts }
        : {}),
      ...(patch.firstUserDelayMs !== undefined
        ? { firstUserDelayMs: patch.firstUserDelayMs }
        : {}),
      ...(patch.everyTimeDelayMs !== undefined
        ? { everyTimeDelayMs: patch.everyTimeDelayMs }
        : {}),
    },
  });

  await rebuildPerformanceScript(shopDomain);
  return result;
}

type AuditField = "auditDeferArray" | "auditHideSelectors" | "staticDeferDefaults" | "firstUserDelayScripts";

const TOGGLE_FIELD_MAP: Record<
  AuditField,
  {
    enabledKey: "auditDeferArrayEnabled" | "auditHideSelectorsEnabled" | "staticDeferDefaultsEnabled" | "firstUserDelayScriptsEnabled";
    preservedKey: "auditDeferArrayPreserved" | "auditHideSelectorsPreserved" | "staticDeferDefaultsPreserved" | "firstUserDelayScriptsPreserved";
  }
> = {
  auditDeferArray: {
    enabledKey: "auditDeferArrayEnabled",
    preservedKey: "auditDeferArrayPreserved",
  },
  auditHideSelectors: {
    enabledKey: "auditHideSelectorsEnabled",
    preservedKey: "auditHideSelectorsPreserved",
  },
  staticDeferDefaults: {
    enabledKey: "staticDeferDefaultsEnabled",
    preservedKey: "staticDeferDefaultsPreserved",
  },
  firstUserDelayScripts: {
    enabledKey: "firstUserDelayScriptsEnabled",
    preservedKey: "firstUserDelayScriptsPreserved",
  },
};

/**
 * Toggle a Step-3 audit field ON/OFF, preserving its data.
 *
 * - OFF: the current active value is snapshotted into the preserved column
 *        and the active column becomes `[]` (storefront receives nothing).
 * - ON:  the preserved value (if any) is restored into the active column.
 * Data is never deleted — it moves between the active and preserved columns.
 * DB-only; the metaobject is NOT touched.
 */
export async function updateAuditFieldToggle(
  shopDomain: string,
  field: AuditField,
  enabled: boolean,
) {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) return null;

  const current = await prisma.storeConfig.findUnique({
    where: { storeId: store.id },
  });

  const { enabledKey, preservedKey } = TOGGLE_FIELD_MAP[field];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = readStringArray(current ? (current as any)[field] : undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preserved = readStringArray(current ? (current as any)[preservedKey] : undefined);

  const nextActive = enabled ? (preserved.length > 0 ? preserved : active) : [];
  const nextPreserved = enabled ? preserved : active;

  const seed = {
    storeId: store.id,
    appEnabled: false,
    script1Enabled: false,
    script2Enabled: false,
    script3Enabled: false,
    debugMode: false,
    scriptTitles: [],
  } as const;

  const result = await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      ...seed,
      [field]: nextActive,
      [enabledKey]: enabled,
      [preservedKey]: nextPreserved,
    },
    update: {
      [field]: nextActive,
      [enabledKey]: enabled,
      [preservedKey]: nextPreserved,
    },
  });

  await rebuildPerformanceScript(shopDomain);
  return result;
}
