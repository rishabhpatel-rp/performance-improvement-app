import prisma from "../db.server";
import { applyFoldPolicy } from "./audit-fold-policy.server";
import { applyHideSelectorHygiene } from "./audit-hide-safety.server";
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
      const { label, path, done } = item as {
        label?: unknown;
        path?: unknown;
        done?: unknown;
      };
      if (typeof label === "string" && typeof path === "string") {
        pages.push({ label, path, ...(done === true ? { done: true } : {}) });
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
  // `ordersCount` is read here but the query above never requests it (there
  // is no top-level `ordersCount` field selected), so `totalOrders` is
  // always undefined. Fixing this for real needs the `read_orders` scope,
  // which is not currently granted (see shopify.app.toml) and would force a
  // re-consent screen on every existing install, so it is left as `undefined`
  // here rather than silently added. Same story for `locale`: Admin's `Shop`
  // type has no `locale` field — it lives on `ShopLocale` behind the
  // `read_locales` (or `read_markets_home`) scope via the separate
  // `shopLocales` query. Both are REQUIREMENTS_AND_PLANS.md R1 issue #2.
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
  // Early backup: keep a StoreArchive copy immediately on uninstall so we
  // never depend solely on Shopify's later shop/redact (~48h) to preserve data.
  if (result.count > 0) {
    try {
      const archive = await archiveStoreSnapshot(shopDomain, {
        reason: "app_uninstalled",
      });
      console.log(
        `[uninstalled] Archived store snapshot for ${shopDomain} (archiveId=${archive.id})`,
      );
    } catch (err) {
      console.error(
        `[uninstalled] Failed to archive snapshot for ${shopDomain}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return result;
}

const SCRIPT_SNAPSHOT_MAX = 2000;

function truncateText(value: string | null | undefined, max = SCRIPT_SNAPSHOT_MAX) {
  if (value == null) return value ?? null;
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…[truncated ${value.length - max} chars]`;
}

export type StoreArchiveReason =
  | "shop_redact"
  | "admin_manual"
  | "app_uninstalled"
  | "pm2_log_backfill";

export type StoreEraseReason = "shop_redact" | "admin_manual";

async function loadStoreForArchive(shopDomain: string) {
  return prisma.store.findUnique({
    where: { shopDomain },
    include: {
      configs: true,
      activities: { orderBy: { createdAt: "desc" }, take: 200 },
      performanceScript: true,
      auditJobs: {
        orderBy: { createdAt: "desc" },
        take: 50,
        select: {
          id: true,
          status: true,
          attempts: true,
          runAt: true,
          lastError: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });
}

/**
 * Write a StoreArchive row for the shop. Does NOT delete live rows.
 * Used on uninstall (early backup) and as the first step of eraseShopData.
 */
export async function archiveStoreSnapshot(
  shopDomain: string,
  opts: {
    reason: StoreArchiveReason;
    actorEmail?: string | null;
    store?: Awaited<ReturnType<typeof loadStoreForArchive>>;
  },
) {
  const store = opts.store ?? (await loadStoreForArchive(shopDomain));

  const psiSnapshots = await prisma.psiSnapshot.findMany({
    where: { shopDomain },
    orderBy: { fetchedAt: "desc" },
    take: 24,
    select: {
      id: true,
      url: true,
      strategy: true,
      lighthouseScore: true,
      lcp: true,
      inp: true,
      cls: true,
      fetchedAt: true,
      fieldSource: true,
    },
  });

  const ps = store?.performanceScript;
  const snapshot = {
    partial: false,
    store: store
      ? {
          ...store,
          configs: undefined,
          activities: undefined,
          performanceScript: undefined,
          auditJobs: undefined,
        }
      : null,
    configs: store?.configs ?? [],
    activities: store?.activities ?? [],
    performanceScript: ps
      ? {
          ...ps,
          deferScript: truncateText(ps.deferScript),
          readableScript: truncateText(ps.readableScript),
          hiddenCss: truncateText(ps.hiddenCss),
          auditScript: truncateText(ps.auditScript),
        }
      : null,
    auditJobs: store?.auditJobs ?? [],
    psiSnapshots,
  };

  return prisma.storeArchive.create({
    data: {
      shopDomain,
      shopifyShopId: store?.shopifyShopId ?? null,
      shopName: store?.shopName ?? null,
      email: store?.email ?? null,
      snapshot,
      reason: opts.reason,
      actorEmail: opts.actorEmail ?? null,
      sourceStoreId: store?.id ?? null,
      installedAt: store?.installedAt ?? null,
      uninstalledAt: store?.uninstalledAt ?? null,
      redactedAt: new Date(),
    },
  });
}

/**
 * Snapshot the shop into StoreArchive, then remove live rows.
 * Skips when the shop has reinstalled and is active again.
 * If the archive insert fails, live rows are left untouched.
 */
export async function eraseShopData(
  shopDomain: string,
  opts: { reason?: StoreEraseReason; actorEmail?: string | null } = {},
) {
  const reason: StoreEraseReason = opts.reason ?? "shop_redact";
  const store = await loadStoreForArchive(shopDomain);

  if (store?.isActive) {
    console.log(
      `[shop/redact] Skip erase for ${shopDomain}: store is active (reinstalled)`,
    );
    return { skipped: true as const };
  }

  const archive = await archiveStoreSnapshot(shopDomain, {
    reason,
    actorEmail: opts.actorEmail,
    store,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await prisma.$transaction(async (tx: any) => {
    await tx.session.deleteMany({ where: { shop: shopDomain } });
    await tx.appTracking.deleteMany({ where: { domain: shopDomain } });
    await tx.auditLog.deleteMany({ where: { domain: shopDomain } });
    await tx.psiSnapshot.deleteMany({ where: { shopDomain } });
    await tx.auditJob.deleteMany({ where: { shopDomain } });

    if (store) {
      await tx.performanceScript.deleteMany({ where: { storeId: store.id } });
      await tx.storeActivity.deleteMany({ where: { storeId: store.id } });
      await tx.storeConfig.deleteMany({ where: { storeId: store.id } });
      await tx.store.delete({ where: { id: store.id } });
    }
  });

  console.log(
    `[shop/redact] Archived then erased shop data for ${shopDomain} (archiveId=${archive.id})`,
  );
  return { skipped: false as const, archiveId: archive.id };
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
  const hygiene = applyHideSelectorHygiene(report.hideSelectors ?? []);
  const foldPolicy = applyFoldPolicy(
    hygiene.hideSelectors,
    (report as { foldAssertion?: { ok: boolean; violations?: string[]; pagesChecked: number } })
      .foldAssertion ?? { ok: true, violations: [], pagesChecked: 0 },
  );
  const activeHide = hideOn ? foldPolicy.hideSelectors : [];
  const reportToPersist = {
    ...report,
    hideSelectors: activeHide,
    warnings: [
      ...((report as { warnings?: string[] }).warnings ?? []),
      ...hygiene.warnings,
      ...foldPolicy.warnings,
    ],
  };

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
      audit_data: reportToPersist,
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

export type { AuditArrayPatch } from "./update-audit-config.server";
export {
  updateAuditArrays,
  updateAuditFieldToggle,
} from "./update-audit-config.server";
