# DETAILED IMPLEMENTATION PLAN
## Store Data Collection + Admin Panel

---

## TABLE OF CONTENTS

1. [Phase 1: Infrastructure Setup](#phase-1)
2. [Phase 2: Database Schema](#phase-2)
3. [Phase 3: Store Sync Utility](#phase-3)
4. [Phase 4: Capture Installation Data](#phase-4)
5. [Phase 5: Capture Uninstallation Data](#phase-5)
6. [Phase 6: Capture Scope Changes](#phase-6)
7. [Phase 7: Sync Config on Dashboard](#phase-7)
8. [Phase 8: Sync Config on Audit Submit](#phase-8)
9. [Phase 9: Admin Panel Scaffold](#phase-9)
10. [Phase 10: Admin Authentication](#phase-10)
11. [Phase 11: Dashboard Overview Page](#phase-11)
12. [Phase 12: Store List Page](#phase-12)
13. [Phase 13: Store Detail Page](#phase-13)
14. [Phase 14: Admin Settings Page](#phase-14)
15. [Phase 15: Testing & Verification](#phase-15)

---

## PHASE 1: Infrastructure Setup {#phase-1}

### What we're doing
Set up PostgreSQL via Docker so both the Shopify app and admin panel can share the same database.

### Step 1.1: Create `docker-compose.yml`
**File:** `custom-app/docker-compose.yml` (project root, NOT inside `performance-improvement-app/`)

```yaml
version: "3.8"
services:
  postgres:
    image: postgres:16-alpine
    container_name: performance-app-db
    restart: unless-stopped
    environment:
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: devpassword123
      POSTGRES_DB: performance_app
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
volumes:
  pgdata:
```

### Step 1.2: Create `init.sql`
**File:** `custom-app/init.sql`

```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
```

### Step 1.3: Start PostgreSQL

```bash
cd /home/rishabh.patel@brainvire.com/Rishabh/Work/custom-app
docker-compose up -d
```

Verify: `docker ps` should show `performance-app-db` running on port 5432.

### Step 1.4: Create `.env` in the Shopify app
**File:** `performance-improvement-app/.env`

```
DATABASE_URL="postgresql://admin:devpassword123@localhost:5432/performance_app?schema=public"
```

Note: All other env vars (`SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET`, etc.) are injected by `shopify app dev` automatically.

---

## PHASE 2: Database Schema {#phase-2}

### What we're doing
Rewrite the Prisma schema to use PostgreSQL and add all new models. The existing SQLite `Session` model is migrated to PostgreSQL.

### Step 2.1: Update `prisma/schema.prisma`
**File:** `performance-improvement-app/prisma/schema.prisma`

Replace the entire file:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// MODEL 1: Session (migrated from SQLite, same structure)
// Used by PrismaSessionStorage for Shopify OAuth sessions
// ============================================================
model Session {
  id                 String    @id
  shop               String
  state              String
  isOnline           Boolean   @default(false)
  scope              String?
  expires            DateTime?
  accessToken        String
  userId             BigInt?
  firstName          String?
  lastName           String?
  email              String?
  accountOwner       Boolean   @default(false)
  locale             String?
  collaborator       Boolean?  @default(false)
  emailVerified      Boolean?  @default(false)
  refreshToken       String?
  refreshTokenExpires DateTime?
}

// ============================================================
// MODEL 2: Store
// Stores details about each Shopify store that installs the app.
// Created on first dashboard visit (after OAuth), updated on uninstall.
// ============================================================
model Store {
  id               String    @id @default(cuid())

  // Shopify identifiers
  shopifyShopId    String    @unique    // Shopify's numeric shop ID or domain
  shopDomain       String    @unique    // e.g. "mystore.myshopify.com"

  // Store details (fetched via GraphQL shop query on first visit)
  shopName         String               // Store name (shop.name)
  email            String               // Store owner email (shop.email)
  country          String?              // Country code (e.g. "US")
  countryName      String?              // Country name (e.g. "United States")
  city             String?              // City
  address1         String?              // Street address line 1
  address2         String?              // Street address line 2
  zip              String?              // Postal code
  timezone         String?              // Human-readable timezone (e.g. "(GMT-05:00) Eastern Time")
  ianaTimezone     String?              // IANA timezone (e.g. "America/New_York")
  currency         String?              // Currency code (e.g. "USD")
  locale           String?              // Primary locale (e.g. "en")

  // Plan & stats
  shopifyPlan      String?              // Plan display name (e.g. "Shopify Plus", "Basic Shopify")
  totalProducts    Int?                 // Product count (from productsCount query)
  totalOrders      Int?                 // Order count (from ordersCount query)
  createdAtShopify DateTime?            // When the shop was created on Shopify

  // App lifecycle tracking
  installedAt      DateTime  @default(now())   // When THIS app was installed
  uninstalledAt    DateTime?                     // When the app was uninstalled (null = still active)
  isActive         Boolean   @default(true)     // false after uninstall
  currentScope     String?                       // Current OAuth access scopes

  // Sync tracking
  lastSyncedAt     DateTime?                     // Last time we synced config from metaobjects

  // Timestamps
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt

  // Relations
  configs          StoreConfig[]
  activities       StoreActivity[]

  @@index([isActive])
  @@index([installedAt])
}

// ============================================================
// MODEL 3: StoreConfig
// Mirrors the Shopify metaobject config for each store.
// Synced on every dashboard load and config change.
// ============================================================
model StoreConfig {
  id                 String   @id @default(cuid())
  storeId            String
  store              Store    @relation(fields: [storeId], references: [id])

  // Script toggles
  appEnabled         Boolean  @default(false)
  script1Enabled     Boolean  @default(false)   // Audit script
  script2Enabled     Boolean  @default(false)   // Defer script
  script3Enabled     Boolean  @default(false)   // Hide CSS script
  debugMode          Boolean  @default(false)
  auditComplete      Boolean  @default(false)

  // Script data (stored as JSON arrays)
  scriptTitles       Json     @default("[]")    // ["Title1","Title2","Title3"]
  auditDeferArray    Json     @default("[]")    // Defer/blocklist entries
  auditHideSelectors Json     @default("[]")    // CSS selectors to hide

  // Reference to the Shopify metaobject
  metaobjectId       String?

  // Timestamps
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([storeId])
}

// ============================================================
// MODEL 4: StoreActivity
// Event log for each store. Every significant action creates
// an activity record for the admin panel timeline.
// ============================================================
model StoreActivity {
  id              String   @id @default(cuid())
  storeId         String
  store           Store    @relation(fields: [storeId], references: [id])

  eventType       String                  // Event type (see below)
  description     String?                 // Human-readable description
  metadata        Json?                   // Additional event-specific data

  createdAt       DateTime @default(now())

  @@index([storeId])
  @@index([eventType])
  @@index([createdAt])
}

// ============================================================
// MODEL 5: AdminUser
// Admin panel login credentials. Passwords hashed with bcrypt.
// ============================================================
model AdminUser {
  id              String   @id @default(cuid())
  email           String   @unique
  passwordHash    String
  name            String?
  role            String   @default("admin")    // "admin" or "viewer"
  lastLoginAt     DateTime?
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

### Activity Event Types (for reference)

| eventType | When it's created | metadata example |
|-----------|-------------------|------------------|
| `installed` | First dashboard visit after OAuth | `{ source: "first_visit", shopDomain: "..." }` |
| `uninstalled` | app/uninstalled webhook | `{ shopDomain: "...", planName: "..." }` |
| `scope_updated` | app/scopes_update webhook | `{ previousScope: "...", newScope: "..." }` |
| `config_changed` | Dashboard config action | `{ changedFields: ["appEnabled", "script1Enabled"] }` |
| `audit_completed` | /audit-submit endpoint | `{ deferCount: 5, hideCount: 3 }` |
| `config_synced` | Dashboard loader (periodic sync) | `{ syncedAt: "..." }` |

### Step 2.2: Generate new migration

```bash
cd performance-improvement-app
npx prisma migrate dev --name migrate-to-postgresql-add-models
```

### Step 2.3: Verify Prisma client

```bash
npx prisma generate
```

Confirm no errors. The Prisma client now has `prisma.store`, `prisma.storeConfig`, `prisma.storeActivity`, `prisma.adminUser` available.

### Step 2.4: `app/db.server.js` — No changes needed
The existing code works with PostgreSQL since it just creates a `PrismaClient()`. The datasource URL comes from `DATABASE_URL` env var.

---

## PHASE 3: Store Sync Utility {#phase-3}

### What we're doing
Create a reusable server-side module with all the functions needed to interact with the new database models. This is the core data layer that all routes will use.

### Step 3.1: Create `app/lib/store-sync.server.ts`
**File:** `performance-improvement-app/app/lib/store-sync.server.ts`

```typescript
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

// ============================================================
// FUNCTION 1: Fetch shop details from Shopify Admin API
// ============================================================

export async function fetchShopDetailsFromShopify(
  admin: any
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
    }`
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

export async function updateStoreScope(
  shopDomain: string,
  newScope: string
) {
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
  config: SyncConfigInput
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    console.warn(
      `[syncConfigToDatabase] No store found for ${shopDomain}. ` +
      `Config sync skipped.`
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
  metadata?: Record<string, any>
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    console.warn(
      `[logActivity] No store found for ${shopDomain}. Activity not logged.`
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
  const [
    totalStores,
    activeStores,
    inactiveStores,
    recentInstalls,
    recentActivity,
  ] = await Promise.all([
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
```

### Step 3.2: Verify the module compiles

```bash
npx tsc --noEmit
```

Fix any TypeScript errors before proceeding.

---

## PHASE 4: Capture Installation Data {#phase-4}

### What we're doing
When a merchant installs the app (OAuth completes) and first opens the dashboard, we fetch their shop details from Shopify and save them to our database.

**Important:** There is NO `app/installed` webhook in Shopify. Installation is detected when the merchant first visits the dashboard after OAuth.

### Step 4.1: Update `app/routes/app._index.jsx` loader
**File:** `performance-improvement-app/app/routes/app._index.jsx`

Modify the `loader` function to:
1. Fetch shop details from Shopify (if store doesn't exist in DB yet)
2. Sync config to database on every load

```javascript
import { useState } from "react";
import { useLoaderData, useFetchers, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  ensureConfig,
  ensureAppEndpoint,
  updateConfig,
  resetAudit,
} from "../lib/metaobjects";
import {
  fetchShopDetailsFromShopify,
  upsertStore,
  syncConfigToDatabase,
  logActivity,
} from "../lib/store-sync.server";
import WizardProgress from "../components/WizardProgress";
import Step1Activate from "../components/Step1Activate";
import Step2Configure from "../components/Step2Configure";
import Step3Titles from "../components/Step3Titles";
import WizardNavigation from "../components/WizardNavigation";
import FooterBranding from "../components/FooterBranding";

const DEFAULT_CONFIG = {
  appEnabled: false,
  script1Enabled: false,
  script2Enabled: false,
  script3Enabled: false,
  scriptTitles: ["", "", ""],
  debugMode: false,
  auditDeferArray: [],
  auditHideSelectors: [],
  auditComplete: false,
  appEndpoint: "",
};

async function safeUpdateConfig(admin, input) {
  try {
    return await updateConfig(admin, input);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No metaobject definition exists")) {
      console.warn(
        "[Dashboard] Metaobject definition not deployed. " +
          "Run shopify app config push. Returning defaults.",
      );
      return { ...DEFAULT_CONFIG, ...input };
    }
    throw err;
  }
}

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  // --- NEW: Sync store details to database (on first visit) ---
  let shopData = null;
  try {
    shopData = await fetchShopDetailsFromShopify(admin);
    shopData.currentScope = session.scope || undefined;
    await upsertStore(shopData);
  } catch (err) {
    console.error(
      "[Dashboard] Failed to sync store details:",
      err instanceof Error ? err.message : err
    );
  }

  const { config } = await ensureConfig(admin);
  const appUrl = process.env.SHOPIFY_APP_URL || "";
  const endpoint = appUrl ? `${appUrl.replace(/\/+$/, "")}/audit-submit` : "";
  const configWithEndpoint = await ensureAppEndpoint(admin, endpoint);
  const mergedConfig = { ...config, ...configWithEndpoint };

  // --- NEW: Sync config to database ---
  try {
    await syncConfigToDatabase(session.shop, {
      appEnabled: mergedConfig.appEnabled,
      script1Enabled: mergedConfig.script1Enabled,
      script2Enabled: mergedConfig.script2Enabled,
      script3Enabled: mergedConfig.script3Enabled,
      debugMode: mergedConfig.debugMode,
      auditComplete: mergedConfig.auditComplete,
      scriptTitles: mergedConfig.scriptTitles,
      auditDeferArray: mergedConfig.auditDeferArray,
      auditHideSelectors: mergedConfig.auditHideSelectors,
    });
  } catch (err) {
    console.error(
      "[Dashboard] Failed to sync config to database:",
      err instanceof Error ? err.message : err
    );
  }

  // --- NEW: Log "installed" event if this is a new store ---
  try {
    const prisma = (await import("../db.server")).default;
    const existingStore = await prisma.store.findUnique({
      where: { shopDomain: session.shop },
      select: { id: true, installedAt: true, createdAt: true },
    });

    // If store was just created (installedAt and createdAt are within 5 seconds)
    if (existingStore && shopData) {
      const now = new Date();
      const createdDiff = now.getTime() - existingStore.createdAt.getTime();
      if (createdDiff < 5000) {
        await logActivity(
          session.shop,
          "installed",
          `App installed — ${shopData.shopName}`,
          { source: "first_visit", shopDomain: session.shop }
        );
      }
    }
  } catch (err) {
    console.error("[Dashboard] Failed to log install event:", err);
  }

  return { config: mergedConfig };
};
```

### Step 4.2: Add config sync to the action function

In the same `app._index.jsx`, after each config change in the `action`, sync to database:

```javascript
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "toggle-app") {
    const appEnabled = formData.get("appEnabled") === "true";
    const config = await safeUpdateConfig(admin, {
      appEnabled,
      ...(appEnabled
        ? { script1Enabled: true, script2Enabled: true, script3Enabled: true }
        : {}),
    });
    if (!appEnabled) {
      try { await resetAudit(admin); } catch { /* ignore */ }
    }

    // --- NEW: Sync to database + log activity ---
    try {
      await syncConfigToDatabase(session.shop, {
        appEnabled: config.appEnabled,
        script1Enabled: config.script1Enabled,
        script2Enabled: config.script2Enabled,
        script3Enabled: config.script3Enabled,
        debugMode: config.debugMode,
        auditComplete: config.auditComplete,
        scriptTitles: config.scriptTitles,
        auditDeferArray: config.auditDeferArray,
        auditHideSelectors: config.auditHideSelectors,
      });
      await logActivity(
        session.shop,
        "config_changed",
        `App ${appEnabled ? "enabled" : "disabled"}`,
        { changedFields: ["appEnabled"] }
      );
    } catch (err) {
      console.error("[Dashboard] DB sync failed:", err);
    }

    return { ok: true, config };
  }

  if (intent === "toggle-script") {
    const scriptIndex = Number(formData.get("scriptIndex"));
    const enabled = formData.get("enabled") === "true";
    const key = ["script1Enabled", "script2Enabled", "script3Enabled"][scriptIndex];
    if (!key) return { ok: false };
    const config = await safeUpdateConfig(admin, { [key]: enabled });

    // --- NEW: Sync + log ---
    try {
      await syncConfigToDatabase(session.shop, {
        appEnabled: config.appEnabled,
        script1Enabled: config.script1Enabled,
        script2Enabled: config.script2Enabled,
        script3Enabled: config.script3Enabled,
        debugMode: config.debugMode,
        auditComplete: config.auditComplete,
        scriptTitles: config.scriptTitles,
        auditDeferArray: config.auditDeferArray,
        auditHideSelectors: config.auditHideSelectors,
      });
      await logActivity(
        session.shop,
        "config_changed",
        `Script ${scriptIndex + 1} ${enabled ? "enabled" : "disabled"}`,
        { changedFields: [key] }
      );
    } catch (err) {
      console.error("[Dashboard] DB sync failed:", err);
    }

    return { ok: true, config };
  }

  if (intent === "save-titles") {
    const scriptTitles = JSON.parse(formData.get("scriptTitles") || "[]");
    const config = await safeUpdateConfig(admin, { scriptTitles });

    try {
      await syncConfigToDatabase(session.shop, {
        appEnabled: config.appEnabled,
        script1Enabled: config.script1Enabled,
        script2Enabled: config.script2Enabled,
        script3Enabled: config.script3Enabled,
        debugMode: config.debugMode,
        auditComplete: config.auditComplete,
        scriptTitles: config.scriptTitles,
        auditDeferArray: config.auditDeferArray,
        auditHideSelectors: config.auditHideSelectors,
      });
    } catch (err) {
      console.error("[Dashboard] DB sync failed:", err);
    }

    return { ok: true, config };
  }

  if (intent === "save-audit-defer") {
    const auditDeferArray = JSON.parse(formData.get("auditDeferArray") || "[]");
    const config = await safeUpdateConfig(admin, { auditDeferArray });

    try {
      await syncConfigToDatabase(session.shop, {
        appEnabled: config.appEnabled,
        script1Enabled: config.script1Enabled,
        script2Enabled: config.script2Enabled,
        script3Enabled: config.script3Enabled,
        debugMode: config.debugMode,
        auditComplete: config.auditComplete,
        scriptTitles: config.scriptTitles,
        auditDeferArray: config.auditDeferArray,
        auditHideSelectors: config.auditHideSelectors,
      });
    } catch (err) {
      console.error("[Dashboard] DB sync failed:", err);
    }

    return { ok: true, config };
  }

  if (intent === "save-audit-hide") {
    const auditHideSelectors = JSON.parse(formData.get("auditHideSelectors") || "[]");
    const config = await safeUpdateConfig(admin, { auditHideSelectors });

    try {
      await syncConfigToDatabase(session.shop, {
        appEnabled: config.appEnabled,
        script1Enabled: config.script1Enabled,
        script2Enabled: config.script2Enabled,
        script3Enabled: config.script3Enabled,
        debugMode: config.debugMode,
        auditComplete: config.auditComplete,
        scriptTitles: config.scriptTitles,
        auditDeferArray: config.auditDeferArray,
        auditHideSelectors: config.auditHideSelectors,
      });
    } catch (err) {
      console.error("[Dashboard] DB sync failed:", err);
    }

    return { ok: true, config };
  }

  return { ok: false };
};
```

### Step 4.3: Verify first install flow

1. Start the Shopify app: `npm run dev`
2. Install the app on a test store
3. Open the app dashboard
4. Check PostgreSQL: `SELECT * FROM "Store"` should show the store record
5. Check: `SELECT * FROM "StoreConfig"` should show the config record
6. Check: `SELECT * FROM "StoreActivity"` should show an "installed" event

---

## PHASE 5: Capture Uninstallation Data {#phase-5}

### What we're doing
When a merchant uninstalls the app, the `app/uninstalled` webhook fires. We update the store record and log the activity.

**Important:** For `app/uninstalled` webhooks, `session` and `admin` are `undefined` because the app has been removed. We can only use the webhook `payload` data.

### Step 5.1: Update `app/routes/webhooks.app.uninstalled.jsx`
**File:** `performance-improvement-app/app/routes/webhooks.app.uninstalled.jsx`

```javascript
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { deleteConfig } from "../lib/metaobjects";
import { markStoreUninstalled, logActivity } from "../lib/store-sync.server";

export const action = async ({ request }) => {
  const { shop, session, topic, admin, payload } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  // Mark the store as uninstalled in our database
  try {
    await markStoreUninstalled(shop);
    await logActivity(
      shop,
      "uninstalled",
      `App uninstalled from ${shop}`,
      {
        shopDomain: shop,
        shopName: payload?.name || undefined,
        planName: payload?.plan_name || undefined,
      }
    );
    console.log(`[uninstalled] Store marked as inactive: ${shop}`);
  } catch (err) {
    console.error(
      `[uninstalled] Failed to update store record for ${shop}:`,
      err instanceof Error ? err.message : err
    );
  }

  // Existing cleanup: delete metaobject config (if session/admin available)
  if (session && admin) {
    try {
      await deleteConfig(admin);
      console.log(`Cleaned up config metaobject for ${shop}`);
    } catch (err) {
      console.log(`Metaobject cleanup skipped for ${shop}: ${err.message}`);
    }

    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
```

### Step 5.2: Verify uninstall flow

1. Uninstall the app from the test store
2. Check PostgreSQL: `SELECT * FROM "Store" WHERE "shopDomain" = '...'`
3. Should show `isActive: false` and `uninstalledAt` set to current time
4. Check: `SELECT * FROM "StoreActivity"` should show an "uninstalled" event

---

## PHASE 6: Capture Scope Changes {#phase-6}

### What we're doing
When the app's access scopes change (e.g., merchant grants additional permissions), we update the store record.

### Step 6.1: Update `app/routes/webhooks.app.scopes_update.jsx`
**File:** `performance-improvement-app/app/routes/webhooks.app.scopes_update.jsx`

```javascript
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { updateStoreScope, logActivity } from "../lib/store-sync.server";

export const action = async ({ request }) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);
  const newScope = payload.current;

  if (session) {
    // Update session scope (existing behavior)
    await db.session.update({
      where: { id: session.id },
      data: { scope: newScope.toString() },
    });

    // --- NEW: Update store record + log activity ---
    try {
      const previousScope = session.scope || "unknown";
      await updateStoreScope(shop, newScope.toString());
      await logActivity(
        shop,
        "scope_updated",
        `Access scopes updated`,
        {
          previousScope,
          newScope: newScope.toString(),
        }
      );
    } catch (err) {
      console.error(
        `[scopes_update] Failed to update store scope for ${shop}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  return new Response();
};
```

---

## PHASE 7: Sync Config on Dashboard {#phase-7}

### What we're doing
This was already covered in Phase 4 (Steps 4.1-4.2). This section documents the complete list of all config sync points.

### Sync points summary

| Location | File | What's synced |
|----------|------|---------------|
| Dashboard loader | `app/routes/app._index.jsx` (loader) | Full config from metaobjects → DB on every page load |
| Toggle app on/off | `app/routes/app._index.jsx` (action, intent: toggle-app) | Config after change → DB + activity log |
| Toggle script | `app/routes/app._index.jsx` (action, intent: toggle-script) | Config after change → DB + activity log |
| Save audit defer | `app/routes/app._index.jsx` (action, intent: save-audit-defer) | Config after change → DB + activity log |
| Save audit hide | `app/routes/app._index.jsx` (action, intent: save-audit-hide) | Config after change → DB + activity log |
| Settings page | `app/routes/app.settings.jsx` (action, intent: reset) | Config after reset → DB + activity log |
| Settings debug mode | `app/routes/app.settings.jsx` (action, default) | Config after change → DB + activity log |

### Step 7.1: Update `app/routes/app.settings.jsx`
**File:** `performance-improvement-app/app/routes/app.settings.jsx`

```javascript
import { useEffect } from "react";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getThemeEditorDeepLink } from "../lib/shopify";
import { getConfig, updateConfig, deleteConfig } from "../lib/metaobjects";
import { syncConfigToDatabase, logActivity } from "../lib/store-sync.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const config = await getConfig(admin);

  // --- NEW: Sync config to database ---
  try {
    await syncConfigToDatabase(session.shop, {
      appEnabled: config.appEnabled,
      script1Enabled: config.script1Enabled,
      script2Enabled: config.script2Enabled,
      script3Enabled: config.script3Enabled,
      debugMode: config.debugMode,
      auditComplete: config.auditComplete,
      scriptTitles: config.scriptTitles,
      auditDeferArray: config.auditDeferArray,
      auditHideSelectors: config.auditHideSelectors,
    });
  } catch (err) {
    console.error("[Settings] DB sync failed:", err);
  }

  return { config, shop: session.shop };
};

export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reset") {
    try {
      await deleteConfig(admin);
    } catch { /* Metaobject may not exist yet */ }

    // --- NEW: Sync + log activity ---
    try {
      await syncConfigToDatabase(session.shop, {
        appEnabled: false,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        auditComplete: false,
        scriptTitles: [],
        auditDeferArray: [],
        auditHideSelectors: [],
      });
      await logActivity(
        session.shop,
        "config_changed",
        "All data reset",
        { changedFields: ["all"] }
      );
    } catch (err) {
      console.error("[Settings] DB sync failed:", err);
    }

    return { ok: true, reset: true };
  }

  // Default: debug mode toggle
  const debugMode = formData.get("debugMode") === "true";
  try {
    const config = await updateConfig(admin, { debugMode });

    // --- NEW: Sync + log activity ---
    try {
      await syncConfigToDatabase(session.shop, {
        appEnabled: config.appEnabled,
        script1Enabled: config.script1Enabled,
        script2Enabled: config.script2Enabled,
        script3Enabled: config.script3Enabled,
        debugMode: config.debugMode,
        auditComplete: config.auditComplete,
        scriptTitles: config.scriptTitles,
        auditDeferArray: config.auditDeferArray,
        auditHideSelectors: config.auditHideSelectors,
      });
      await logActivity(
        session.shop,
        "config_changed",
        `Debug mode ${debugMode ? "enabled" : "disabled"}`,
        { changedFields: ["debugMode"] }
      );
    } catch (err) {
      console.error("[Settings] DB sync failed:", err);
    }

    return { ok: true, config };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No metaobject definition exists")) {
      return { ok: true, config: { debugMode } };
    }
    throw err;
  }
};

export default function Settings() {
  const { config, shop } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(
        fetcher.data.reset ? "All data reset" : "Settings saved",
      );
    }
  }, [fetcher.data, shopify]);

  const current = fetcher.data?.config || config;

  const updateSetting = (key, value) => {
    fetcher.submit(
      { debugMode: String(key === "debugMode" ? value : current.debugMode) },
      { method: "POST" },
    );
  };

  const handleReset = () => {
    if (
      !confirm(
        "Delete all scripts and settings for this shop? This cannot be undone.",
      )
    )
      return;
    fetcher.submit({ intent: "reset" }, { method: "POST" });
  };

  const themeEditorUrl = getThemeEditorDeepLink(shop);

  return (
    <s-page heading="Settings" backAction="/app">
      <s-section heading="General">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Debug mode"
            helpText="Adds console logging to injected scripts"
            checked={current.debugMode}
            onChange={(e) => updateSetting("debugMode", e.target.checked)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Theme app extension">
        <s-paragraph>
          Add and configure script blocks in the theme editor.
        </s-paragraph>
        <s-button href={themeEditorUrl} target="_blank">
          Open theme editor
        </s-button>
      </s-section>

      <s-section heading="Danger zone">
        <s-paragraph>
          Permanently delete all scripts and settings for this shop.
        </s-paragraph>
        <s-button tone="critical" onClick={handleReset}>
          Reset all data
        </s-button>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

---

## PHASE 8: Sync Config on Audit Submit {#phase-8}

### What we're doing
When the storefront audit script posts results to `/audit-submit`, we also sync the updated config to the database.

### Step 8.1: Update `app/routes/audit-submit.jsx`
**File:** `performance-improvement-app/app/routes/audit-submit.jsx`

```javascript
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { setAuditResults, getConfig } from "../lib/metaobjects";
import { syncConfigToDatabase, logActivity } from "../lib/store-sync.server";

function shopFromHost(hostname) {
  if (!hostname) return null;
  const host = hostname.replace(/^www\./i, "");
  if (host.endsWith(".myshopify.com")) return host;
  return host;
}

function deriveShop(request) {
  const origin =
    request.headers.get("Origin") || request.headers.get("Referer");
  if (!origin) return null;
  try {
    const url = new URL(origin);
    return shopFromHost(url.hostname);
  } catch {
    return null;
  }
}

function sanitizeStringArray(value, max = 500) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

export const action = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const originShop = deriveShop(request);
  if (!originShop) {
    return new Response(
      JSON.stringify({ ok: false, error: "shop not resolvable" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  const session = await db.session.findFirst({
    where: { shop: originShop, isOnline: false },
  });
  if (!session) {
    return new Response(JSON.stringify({ ok: false }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid json" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const deferArray = sanitizeStringArray(body?.deferArray);
  const hideSelectors = sanitizeStringArray(body?.hideSelectors);

  try {
    const { admin } = await unauthenticated.admin(originShop);
    await setAuditResults(admin, { deferArray, hideSelectors });

    // --- NEW: Sync updated config to database + log activity ---
    try {
      const updatedConfig = await getConfig(admin);
      await syncConfigToDatabase(originShop, {
        appEnabled: updatedConfig.appEnabled,
        script1Enabled: updatedConfig.script1Enabled,
        script2Enabled: updatedConfig.script2Enabled,
        script3Enabled: updatedConfig.script3Enabled,
        debugMode: updatedConfig.debugMode,
        auditComplete: updatedConfig.auditComplete,
        scriptTitles: updatedConfig.scriptTitles,
        auditDeferArray: updatedConfig.auditDeferArray,
        auditHideSelectors: updatedConfig.auditHideSelectors,
      });
      await logActivity(
        originShop,
        "audit_completed",
        `Audit completed — ${deferArray.length} defer entries, ${hideSelectors.length} hide selectors`,
        { deferCount: deferArray.length, hideCount: hideSelectors.length }
      );
    } catch (err) {
      console.error(
        `[audit-submit] Failed to sync config for ${originShop}:`,
        err instanceof Error ? err.message : err
      );
    }
    // --- END NEW ---

  } catch (err) {
    console.error(
      `[audit-submit] Failed to write audit results for ${originShop}:`,
      err,
    );
    return new Response(JSON.stringify({ ok: false }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
    },
  });
};

export const loader = async ({ request }) => {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": request.headers.get("Origin") || "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }
  return new Response("Not Found", { status: 404 });
};
```

### Step 8.2: Update `shopify.app.toml` scopes
**File:** `performance-improvement-app/shopify.app.toml`

Update the scopes line to include read permissions needed for shop details:

```toml
[access_scopes]
scopes = "write_metaobject_definitions,write_metaobjects,write_products,read_products,read_orders,read_locales"
```

Note: The `shop` GraphQL query works with ANY authenticated access (no special scope needed). `read_products` is for `productsCount`, `read_orders` for `ordersCount`, and `read_locales` for locale data.

---

## PHASE 9: Admin Panel Scaffold {#phase-9}

### What we're doing
Create a new Next.js project for the admin panel.

### Step 9.1: Scaffold the Next.js app

```bash
cd /home/rishabh.patel@brainvire.com/Rishabh/Work/custom-app
npx create-next-app@latest admin-panel \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbopack
```

### Step 9.2: Install dependencies

```bash
cd admin-panel
npm install prisma @prisma/client bcryptjs iron-session
npm install -D @types/bcryptjs
```

### Step 9.3: Install Shadcn/UI

```bash
npx shadcn@latest init
# Select: New York style, Slate base color, CSS variables: yes

npx shadcn@latest add button card table input label badge \
  dropdown-menu avatar separator sheet tabs toast
```

### Step 9.4: Set up Prisma

```bash
npx prisma init
```

### Step 9.5: Create `.env` for admin panel

**File:** `admin-panel/.env`

```
DATABASE_URL="postgresql://admin:devpassword123@localhost:5432/performance_app?schema=public"
ADMIN_SESSION_PASSWORD="your-super-secret-session-password-at-least-32-chars!!"
```

### Step 9.6: Copy Prisma schema
Copy the schema from Phase 2 into `admin-panel/prisma/schema.prisma`. The admin panel only needs to READ from the database (except for `AdminUser` which it manages).

### Step 9.7: Generate Prisma client

```bash
npx prisma generate
```

### Step 9.8: Create Prisma client singleton

**File:** `admin-panel/src/lib/prisma.ts`

```typescript
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

### Step 9.9: Project structure

```
admin-panel/
├── prisma/
│   └── schema.prisma
├── src/
│   ├── app/
│   │   ├── layout.tsx              # Root layout with fonts
│   │   ├── page.tsx                # Redirect to /dashboard or /login
│   │   ├── login/
│   │   │   └── page.tsx            # Login form
│   │   ├── setup/
│   │   │   └── page.tsx            # First-time admin setup
│   │   └── dashboard/
│   │       ├── layout.tsx          # Auth-protected layout with sidebar
│   │       ├── page.tsx            # Overview: stats cards + recent activity
│   │       ├── stores/
│   │       │   ├── page.tsx        # Store list table
│   │       │   └── [domain]/
│   │       │       └── page.tsx    # Store detail page
│   │       └── settings/
│   │           └── page.tsx        # Admin profile management
│   ├── lib/
│   │   ├── prisma.ts               # Prisma client singleton
│   │   ├── auth.ts                 # Session management
│   │   ├── queries.ts              # Database read queries
│   │   └── utils.ts                # Helper functions
│   ├── components/
│   │   ├── ui/                     # Shadcn/UI components (auto-generated)
│   │   ├── sidebar.tsx             # Navigation sidebar
│   │   ├── stats-cards.tsx         # Dashboard stat cards
│   │   ├── store-table.tsx         # Store list DataTable
│   │   ├── store-detail.tsx        # Store detail view
│   │   ├── config-viewer.tsx       # Read-only config display
│   │   └── activity-timeline.tsx   # Event timeline
│   └── middleware.ts               # Auth middleware
├── package.json
├── tailwind.config.ts
└── tsconfig.json
```

---

## PHASE 10: Admin Authentication {#phase-10}

### What we're doing
Implement email + password login for the admin panel using iron-session.

### Step 10.1: Create auth utility

**File:** `admin-panel/src/lib/auth.ts`

```typescript
import { getIronSession } from "iron-session";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export interface AdminSession {
  userId: string;
  email: string;
  name: string | null;
  role: string;
  isLoggedIn: boolean;
}

const SESSION_PASSWORD =
  process.env.ADMIN_SESSION_PASSWORD || "default-password-change-me-in-production!!";

export async function getAdminSession() {
  const cookieStore = await cookies();
  return getIronSession<AdminSession>(cookieStore, {
    password: SESSION_PASSWORD,
    cookieName: "admin-session",
    cookieOptions: {
      secure: process.env.NODE_ENV === "production",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
    },
  });
}

export async function loginAdmin(email: string, password: string) {
  const user = await prisma.adminUser.findUnique({ where: { email } });
  if (!user) return null;

  const isValid = await bcrypt.compare(password, user.passwordHash);
  if (!isValid) return null;

  await prisma.adminUser.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const session = await getAdminSession();
  session.userId = user.id;
  session.email = user.email;
  session.name = user.name;
  session.role = user.role;
  session.isLoggedIn = true;
  await session.save();

  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

export async function logoutAdmin() {
  const session = await getAdminSession();
  await session.destroy();
}

export async function requireAdmin() {
  const session = await getAdminSession();
  if (!session.isLoggedIn) {
    return null;
  }
  return session;
}
```

### Step 10.2: Create auth middleware

**File:** `admin-panel/src/middleware.ts`

```typescript
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const session = request.cookies.get("admin-session");
  const isLoginPage = request.nextUrl.pathname === "/login";
  const isSetupPage = request.nextUrl.pathname === "/setup";
  const isRootPage = request.nextUrl.pathname === "/";

  if (isLoginPage || isSetupPage) {
    return NextResponse.next();
  }

  if (isRootPage) {
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (!session) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
```

### Step 10.3: Create login page

**File:** `admin-panel/src/app/login/page.tsx`

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (data.success) {
        router.push("/dashboard");
      } else {
        setError(data.error || "Invalid credentials");
      }
    } catch {
      setError("An error occurred. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Admin Login</CardTitle>
          <CardDescription>
            Sign in to the performance app admin panel
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? "Signing in..." : "Sign in"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

### Step 10.4: Create login API route

**File:** `admin-panel/src/app/api/auth/login/route.ts`

```typescript
import { NextResponse } from "next/server";
import { loginAdmin } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json(
        { success: false, error: "Email and password are required" },
        { status: 400 }
      );
    }

    const user = await loginAdmin(email, password);

    if (!user) {
      return NextResponse.json(
        { success: false, error: "Invalid email or password" },
        { status: 401 }
      );
    }

    return NextResponse.json({ success: true, user });
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { success: false, error: "An error occurred" },
      { status: 500 }
    );
  }
}
```

### Step 10.5: Create logout API route

**File:** `admin-panel/src/app/api/auth/logout/route.ts`

```typescript
import { NextResponse } from "next/server";
import { logoutAdmin } from "@/lib/auth";

export async function POST() {
  await logoutAdmin();
  return NextResponse.json({ success: true });
}
```

### Step 10.6: Create admin seed script

**File:** `admin-panel/prisma/seed.ts`

```typescript
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const email = "admin@performance-app.com";
  const password = "admin123";
  const name = "Admin";

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists. Skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name,
      role: "admin",
    },
  });

  console.log(`Admin user created: ${email} / ${password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

Add to `admin-panel/package.json`:

```json
{
  "prisma": {
    "seed": "npx tsx prisma/seed.ts"
  }
}
```

Run seed:

```bash
npx prisma db seed
```

### Step 10.7: Create setup page (first-time admin creation)

**File:** `admin-panel/src/app/setup/page.tsx`

This page lets you create the first admin user if none exists. It calls an API route that checks if any admin users exist and creates one if not.

---

## PHASE 11: Dashboard Overview Page {#phase-11}

### What we're doing
Build the main dashboard showing store statistics and recent activity.

### Step 11.1: Create dashboard layout with sidebar

**File:** `admin-panel/src/app/dashboard/layout.tsx`

```tsx
import { requireAdmin } from "@/lib/auth";
import { redirect } from "next/navigation";
import Sidebar from "@/components/sidebar";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();
  if (!session) redirect("/login");

  return (
    <div className="min-h-screen flex">
      <Sidebar user={session} />
      <main className="flex-1 p-8 bg-gray-50">{children}</main>
    </div>
  );
}
```

### Step 11.2: Create Sidebar component

**File:** `admin-panel/src/components/sidebar.tsx`

Links: Dashboard (`/dashboard`), Stores (`/dashboard/stores`), Settings (`/dashboard/settings`). Includes logout button.

### Step 11.3: Create StatsCards component

**File:** `admin-panel/src/components/stats-cards.tsx`

Displays 4 cards: Total Stores, Active Stores, Inactive Stores, Recently Installed (last 7 days).

### Step 11.4: Create dashboard page

**File:** `admin-panel/src/app/dashboard/page.tsx`

```tsx
import { getDashboardStats } from "@/lib/queries";
import StatsCards from "@/components/stats-cards";
import ActivityTimeline from "@/components/activity-timeline";

export default async function DashboardPage() {
  const stats = await getDashboardStats();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <StatsCards stats={stats} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div>
          <h2 className="text-xl font-semibold mb-4">Recent Installs</h2>
          {/* Table of recent installs */}
        </div>
        <div>
          <h2 className="text-xl font-semibold mb-4">Recent Activity</h2>
          <ActivityTimeline activities={stats.recentActivity} />
        </div>
      </div>
    </div>
  );
}
```

### Step 11.5: Create database queries file

**File:** `admin-panel/src/lib/queries.ts`

```typescript
import { prisma } from "./prisma";

export async function getDashboardStats() {
  const [
    totalStores,
    activeStores,
    inactiveStores,
    recentInstalls,
    recentActivity,
  ] = await Promise.all([
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
    recentInstalls,
    recentActivity,
  };
}

export async function getStores(options?: {
  isActive?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}) {
  const page = options?.page || 1;
  const pageSize = options?.pageSize || 20;
  const skip = (page - 1) * pageSize;

  const where: any = {};
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
    totalPages: Math.ceil(total / pageSize),
  };
}

export async function getStoreByDomain(domain: string) {
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
```

---

## PHASE 12: Store List Page {#phase-12}

### What we're doing
Build a searchable, filterable table of all stores.

### Step 12.1: Create store list page

**File:** `admin-panel/src/app/dashboard/stores/page.tsx`

```tsx
import { getStores } from "@/lib/queries";
import StoreTable from "@/components/store-table";

export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ search?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const result = await getStores({
    search: params.search,
    isActive:
      params.status === "active"
        ? true
        : params.status === "inactive"
          ? false
          : undefined,
    page: params.page ? parseInt(params.page) : 1,
    pageSize: 20,
  });

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Stores</h1>
      <StoreTable
        stores={result.stores}
        total={result.total}
        page={result.page}
        totalPages={result.totalPages}
      />
    </div>
  );
}
```

### Step 12.2: Create StoreTable component

**File:** `admin-panel/src/components/store-table.tsx`

Uses Shadcn/UI Table component. Columns:
- Shop Name (linked to detail page)
- Domain
- Email
- Country
- Status (Active/Inactive badge)
- Installed At (formatted date)
- Last Synced

Includes:
- Search input (URL-based, updates searchParams)
- Status filter dropdown
- Pagination controls

---

## PHASE 13: Store Detail Page {#phase-13}

### What we're doing
Build the detailed view for a single store showing all info, config, and activity.

### Step 13.1: Create store detail page

**File:** `admin-panel/src/app/dashboard/stores/[domain]/page.tsx`

```tsx
import { getStoreByDomain } from "@/lib/queries";
import { notFound } from "next/navigation";
import StoreDetail from "@/components/store-detail";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ domain: string }>;
}) {
  const { domain } = await params;
  const store = await getStoreByDomain(domain);

  if (!store) notFound();

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">{store.shopName}</h1>
      <StoreDetail store={store} />
    </div>
  );
}
```

### Step 13.2: Create StoreDetail component

**File:** `admin-panel/src/components/store-detail.tsx`

Two-column layout:

**Left column — Store Info Card:**
- Shop Name
- Domain (linked to Shopify admin)
- Email
- Country / City / Address
- Timezone (IANA + display)
- Currency
- Shopify Plan
- Products count / Orders count
- Shop created date
- App installed date
- App uninstalled date (if applicable)
- Status badge (Active/Inactive)
- Current scopes

**Right column — Tabs:**

**Tab 1: Configuration**
- App Enabled toggle (read-only display)
- Script 1/2/3 Enabled (read-only)
- Debug Mode
- Audit Complete status
- Script Titles (list)
- Audit Defer Array (list)
- Audit Hide Selectors (list)
- Metaobject ID
- Last Synced timestamp

**Tab 2: Activity Timeline**
- Chronological list of all events
- Each event shows: event type badge, description, timestamp, metadata (expandable)

### Step 13.3: Create ConfigViewer component

**File:** `admin-panel/src/components/config-viewer.tsx`

Read-only display of the store's configuration from `StoreConfig`.

### Step 13.4: Create ActivityTimeline component

**File:** `admin-panel/src/components/activity-timeline.tsx`

Displays `StoreActivity` records with:
- Event type badge (color-coded: green for installed, red for uninstalled, blue for config_changed, etc.)
- Description text
- Timestamp (relative + absolute on hover)
- Metadata (expandable JSON viewer)

---

## PHASE 14: Admin Settings Page {#phase-14}

### What we're doing
Let the admin manage their profile (change password, name).

### Step 14.1: Create settings page

**File:** `admin-panel/src/app/dashboard/settings/page.tsx`

Form to update:
- Name
- Email
- Change password (requires current password)

### Step 14.2: Create settings API routes

**File:** `admin-panel/src/app/api/auth/update-profile/route.ts`
**File:** `admin-panel/src/app/api/auth/change-password/route.ts`

---

## PHASE 15: Testing & Verification {#phase-15}

### Step 15.1: Start PostgreSQL

```bash
cd /home/rishabh.patel@brainvire.com/Rishabh/Work/custom-app
docker-compose up -d
```

### Step 15.2: Run migrations

```bash
# Shopify app
cd performance-improvement-app
npx prisma migrate dev --name initial-postgresql

# Admin panel
cd ../admin-panel
npx prisma migrate dev --name initial
npx prisma db seed
```

### Step 15.3: Start Shopify app

```bash
cd performance-improvement-app
npm run dev
```

### Step 15.4: Test installation flow

1. Install the app on a test store
2. Open the app dashboard
3. Verify PostgreSQL has:
   - `Store` record with all shop details
   - `StoreConfig` record with default config
   - `StoreActivity` record with "installed" event

### Step 15.5: Test config sync

1. Toggle the app ON in Step 1
2. Toggle scripts in Step 2
3. Verify `StoreConfig` updated in PostgreSQL
4. Verify `StoreActivity` has "config_changed" events

### Step 15.6: Test audit submit

1. Visit the storefront (triggers audit script)
2. Wait for audit to complete
3. Verify `StoreConfig.auditComplete` is `true` in PostgreSQL
4. Verify `StoreActivity` has "audit_completed" event

### Step 15.7: Test scope update

1. Update app scopes (if possible in dev)
2. Verify `Store.currentScope` updated
3. Verify `StoreActivity` has "scope_updated" event

### Step 15.8: Test uninstall

1. Uninstall the app from the test store
2. Verify `Store.isActive` is `false`
3. Verify `Store.uninstalledAt` is set
4. Verify `StoreActivity` has "uninstalled" event

### Step 15.9: Test admin panel

1. Start admin panel: `cd admin-panel && npm run dev`
2. Open `http://localhost:3000`
3. Login with seeded admin credentials
4. Verify dashboard shows correct stats
5. Verify store list shows all stores
6. Click a store → verify detail page shows all info, config, and activity

### Step 15.10: Run type checks

```bash
# Shopify app
cd performance-improvement-app
npm run typecheck

# Admin panel
cd ../admin-panel
npx tsc --noEmit
```

### Step 15.11: Run lint

```bash
# Shopify app
npm run lint

# Admin panel
npm run lint
```

---

## COMPLETE FILE CHANGE SUMMARY

### Modified files (existing Shopify app)

| File | Changes |
|------|---------|
| `prisma/schema.prisma` | SQLite → PostgreSQL + 4 new models (Store, StoreConfig, StoreActivity, AdminUser) |
| `shopify.app.toml` | Add `read_products,read_orders,read_locales` scopes |
| `app/routes/app._index.jsx` | Add imports, sync store details + config to DB in loader and actions |
| `app/routes/app.settings.jsx` | Add imports, sync config to DB after changes |
| `app/routes/webhooks.app.uninstalled.jsx` | Add `markStoreUninstalled` + `logActivity` calls |
| `app/routes/webhooks.app.scopes_update.jsx` | Add `updateStoreScope` + `logActivity` calls |
| `app/routes/audit-submit.jsx` | Add config sync + activity logging after audit results |
| `.env` (new) | `DATABASE_URL` for PostgreSQL |

### New files (Shopify app)

| File | Purpose |
|------|---------|
| `app/lib/store-sync.server.ts` | Core data layer — all DB sync functions |
| `docker-compose.yml` | PostgreSQL container (at project root) |
| `init.sql` | PostgreSQL init script (at project root) |

### New files (Admin panel — entire directory)

| File | Purpose |
|------|---------|
| `admin-panel/prisma/schema.prisma` | Same schema (shared DB) |
| `admin-panel/prisma/seed.ts` | Seed initial admin user |
| `admin-panel/src/lib/prisma.ts` | Prisma client singleton |
| `admin-panel/src/lib/auth.ts` | Iron-session auth utilities |
| `admin-panel/src/lib/queries.ts` | Database read queries |
| `admin-panel/src/middleware.ts` | Auth middleware |
| `admin-panel/src/app/layout.tsx` | Root layout |
| `admin-panel/src/app/page.tsx` | Root redirect |
| `admin-panel/src/app/login/page.tsx` | Login form |
| `admin-panel/src/app/setup/page.tsx` | First-time admin setup |
| `admin-panel/src/app/api/auth/login/route.ts` | Login API |
| `admin-panel/src/app/api/auth/logout/route.ts` | Logout API |
| `admin-panel/src/app/dashboard/layout.tsx` | Auth-protected layout |
| `admin-panel/src/app/dashboard/page.tsx` | Overview page |
| `admin-panel/src/app/dashboard/stores/page.tsx` | Store list page |
| `admin-panel/src/app/dashboard/stores/[domain]/page.tsx` | Store detail page |
| `admin-panel/src/app/dashboard/settings/page.tsx` | Admin settings page |
| `admin-panel/src/components/sidebar.tsx` | Navigation sidebar |
| `admin-panel/src/components/stats-cards.tsx` | Dashboard stat cards |
| `admin-panel/src/components/store-table.tsx` | Store list table |
| `admin-panel/src/components/store-detail.tsx` | Store detail view |
| `admin-panel/src/components/config-viewer.tsx` | Config display |
| `admin-panel/src/components/activity-timeline.tsx` | Event timeline |

---

## ESTIMATED TIMELINE

| Phase | Task | Days |
|-------|------|------|
| 1 | Infrastructure setup (Docker, .env) | 0.25 |
| 2 | Database schema + migration | 0.5 |
| 3 | Store sync utility module | 0.75 |
| 4 | Capture installation data | 0.75 |
| 5 | Capture uninstallation data | 0.25 |
| 6 | Capture scope changes | 0.25 |
| 7 | Config sync on dashboard | 0.5 |
| 8 | Config sync on audit submit | 0.25 |
| 9 | Admin panel scaffold | 0.5 |
| 10 | Admin authentication | 1 |
| 11 | Dashboard overview page | 1 |
| 12 | Store list page | 0.75 |
| 13 | Store detail page | 1 |
| 14 | Admin settings page | 0.5 |
| 15 | Testing & verification | 1 |
| **Total** | | **~9.25 days** |
