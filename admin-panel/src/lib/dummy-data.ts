// In-memory dummy dataset used when demo mode is ON (see lib/demo-mode.ts).
// Nothing here ever touches the database — it exists purely so the admin
// panel looks like a real, populated app for demos and screenshots.
//
// `generateDummyStores` builds ~32 realistic, varied stores once (module
// load) and every downstream helper (`getDummyStores`,
// `getDummyStoreByDomain`) reads from that same array so numbers stay
// consistent across pages.

import type {
  StoresResult,
  StoreWithDetails,
  StoreActivity as StoreActivityType,
  StoreWithConfigs,
} from "./types";

const now = Date.now();
const day = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Seeded pseudo-random generator so the dataset is stable across requests
// within a single server process, but still looks varied.
// ---------------------------------------------------------------------------
function makeRng(seed: number) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

function pick<T>(rng: () => number, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

// ---------------------------------------------------------------------------
// Reference data pools
// ---------------------------------------------------------------------------
const STORE_NAMES = [
  "Aurora Apparel", "Bloom Botanics", "Peak Performance Co.", "Northwind Coffee",
  "Pebble Toys", "Cedar & Sage", "Lunarwave Electronics", "Harbor Home Goods",
  "Velvet Thread Studio", "Ironclad Fitness", "Sundrop Skincare", "Maple & Moss",
  "Coastal Kite Co.", "Granite Peak Outfitters", "Willow Lane Candles", "Nimbus Sportswear",
  "Copper Kettle Kitchenware", "Fernwood Furnishings", "Solace Sleep Co.", "Marigold Market",
  "Driftwood Denim", "Everstone Jewelry", "Little Acorn Kids", "Palmetto Provisions",
  "Nova Audio", "Rustic Root Bakery", "Bluebird Stationery", "Alpine Gear Supply",
  "Terracotta Home", "Wanderlux Travel Goods", "Sable & Stone", "Prairie Wind Textiles",
];

const COUNTRIES: Array<{
  code: string;
  name: string;
  currency: string;
  cities: string[];
  timezone: string;
  ianaTimezone: string;
  locale: string;
}> = [
  { code: "US", name: "United States", currency: "USD", cities: ["Austin", "Portland", "Denver", "Chicago", "Miami"], timezone: "(GMT-05:00) Eastern Time", ianaTimezone: "America/New_York", locale: "en" },
  { code: "CA", name: "Canada", currency: "CAD", cities: ["Vancouver", "Toronto", "Montreal", "Calgary"], timezone: "(GMT-05:00) Eastern Time", ianaTimezone: "America/Toronto", locale: "en-CA" },
  { code: "GB", name: "United Kingdom", currency: "GBP", cities: ["London", "Manchester", "Bristol", "Leeds"], timezone: "(GMT+00:00) London", ianaTimezone: "Europe/London", locale: "en-GB" },
  { code: "DE", name: "Germany", currency: "EUR", cities: ["Berlin", "Munich", "Hamburg"], timezone: "(GMT+01:00) Berlin", ianaTimezone: "Europe/Berlin", locale: "de" },
  { code: "AU", name: "Australia", currency: "AUD", cities: ["Sydney", "Melbourne", "Brisbane"], timezone: "(GMT+10:00) Sydney", ianaTimezone: "Australia/Sydney", locale: "en-AU" },
  { code: "IN", name: "India", currency: "INR", cities: ["Ahmedabad", "Mumbai", "Bengaluru"], timezone: "(GMT+05:30) India Standard Time", ianaTimezone: "Asia/Kolkata", locale: "en-IN" },
  { code: "FR", name: "France", currency: "EUR", cities: ["Paris", "Lyon", "Marseille"], timezone: "(GMT+01:00) Paris", ianaTimezone: "Europe/Paris", locale: "fr" },
  { code: "NL", name: "Netherlands", currency: "EUR", cities: ["Amsterdam", "Rotterdam"], timezone: "(GMT+01:00) Amsterdam", ianaTimezone: "Europe/Amsterdam", locale: "nl" },
];

const STREET_NAMES = ["Main St", "Harbour Rd", "Elm Ave", "5th St", "Britannia St", "Oak Lane", "King's Rd", "Market St", "River Walk", "Highland Dr"];
const UNIT_LABELS = ["", "", "", "Suite 100", "Unit 4B", "Floor 2"];
const PLANS = ["Basic Shopify", "Shopify", "Advanced Shopify", "Shopify Plus"];
const SCOPES = [
  "read_products,write_products,read_orders",
  "read_products,read_orders",
  "read_products,write_products,read_orders,write_orders",
  "read_products,read_orders,read_customers",
];
const AUDIT_DEFER_SCRIPTS = [
  "https://cdn.example.com/scripts/analytics.js",
  "https://cdn.example.com/scripts/reviews-widget.js",
  "https://cdn.example.com/scripts/chat-widget.js",
  "https://cdn.example.com/scripts/upsell.js",
  "https://cdn.example.com/scripts/social-proof.js",
];
const AUDIT_HIDE_SELECTORS = [
  "#sticky-banner", ".announcement-bar", ".third-party-popup",
  "#newsletter-modal", ".cookie-consent-old", ".legacy-widget",
];
const EVENT_TYPES = [
  "installed",
  "config_changed",
  "scope_updated",
  "audit_completed",
  "uninstalled",
] as const;

// ---------------------------------------------------------------------------
// Store generation
// ---------------------------------------------------------------------------
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function generateActivities(
  storeId: string,
  shopName: string,
  shopDomain: string,
  installedAt: Date,
  uninstalledAt: Date | null,
  rng: () => number,
): StoreActivityType[] {
  const count = randInt(rng, 2, 5);
  const activities: StoreActivityType[] = [];
  const storeRef = { shopName, shopDomain };

  activities.push({
    id: `act_${storeId}_installed`,
    storeId,
    eventType: "installed",
    description: "App installed",
    metadata: null,
    createdAt: installedAt,
    store: storeRef,
  });

  const remaining = count - 1 - (uninstalledAt ? 1 : 0);
  for (let i = 0; i < Math.max(0, remaining); i++) {
    const eventType = pick(
      rng,
      EVENT_TYPES.filter((e) => e !== "installed" && e !== "uninstalled"),
    );
    const offsetDays = randInt(rng, 1, 60);
    const createdAt = new Date(
      Math.min(now, installedAt.getTime() + offsetDays * day),
    );
    const descriptions: Record<string, string> = {
      config_changed: "Updated script configuration",
      scope_updated: "OAuth scope updated after re-authorization",
      audit_completed: "Accessibility audit completed",
    };
    activities.push({
      id: `act_${storeId}_${i}`,
      storeId,
      eventType,
      description: descriptions[eventType] ?? null,
      metadata: eventType === "config_changed" ? { scripts: ["script1", "script2"] } : null,
      createdAt,
      store: storeRef,
    });
  }

  if (uninstalledAt) {
    activities.push({
      id: `act_${storeId}_uninstalled`,
      storeId,
      eventType: "uninstalled",
      description: "App uninstalled",
      metadata: null,
      createdAt: uninstalledAt,
      store: storeRef,
    });
  }

  return activities.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

interface DummyStore extends StoreWithConfigs {
  activities: StoreActivityType[];
}

function generateDummyStores(count = 32): DummyStore[] {
  const rng = makeRng(42);
  const stores: DummyStore[] = [];

  for (let i = 0; i < count; i++) {
    const name = STORE_NAMES[i % STORE_NAMES.length];
    const slug = slugify(name);
    const domain = `${slug}.myshopify.com`;
    const country = pick(rng, COUNTRIES);
    const city = pick(rng, country.cities);
    const street = pick(rng, STREET_NAMES);
    const unit = pick(rng, UNIT_LABELS);

    // ~2/3 active, ~1/3 inactive (with an uninstalledAt).
    const isActive = rng() < 0.67;

    // ~5 stores installed within the last 7 days; rest spread over 18 months.
    const installedWithinLast7Days = i < 5;
    const installedAt = installedWithinLast7Days
      ? new Date(now - randInt(rng, 0, 6) * day)
      : new Date(now - randInt(rng, 8, 540) * day);

    const uninstalledAt = !isActive
      ? new Date(
          Math.min(
            now,
            installedAt.getTime() + randInt(rng, 5, 400) * day,
          ),
        )
      : null;

    const lastSyncedAt = isActive
      ? new Date(now - randInt(rng, 0, 5) * day)
      : uninstalledAt;

    const createdAtShopify = new Date(
      installedAt.getTime() - randInt(rng, 100, 1200) * day,
    );

    const storeId = `dummy_store_${i + 1}`;
    const shopifyShopId = String(9000000 + i * 37);

    const auditComplete = rng() < 0.5;
    const configId = `dummy_cfg_${i + 1}`;

    const store: DummyStore = {
      id: storeId,
      shopifyShopId,
      shopDomain: domain,
      shopName: name,
      email: `owner@${slug}.com`,
      country: country.code,
      countryName: country.name,
      city,
      address1: `${randInt(rng, 10, 999)} ${street}`,
      address2: unit,
      zip: String(randInt(rng, 10000, 99999)),
      timezone: country.timezone,
      ianaTimezone: country.ianaTimezone,
      currency: country.currency,
      locale: country.locale,
      shopifyPlan: pick(rng, PLANS),
      totalProducts: randInt(rng, 10, 5000),
      totalOrders: randInt(rng, 0, 200000),
      createdAtShopify,
      installedAt,
      uninstalledAt,
      isActive,
      currentScope: pick(rng, SCOPES),
      lastSyncedAt,
      createdAt: installedAt,
      updatedAt: lastSyncedAt ?? installedAt,
      configs: [
        {
          id: configId,
          storeId,
          appEnabled: rng() < 0.85,
          script1Enabled: rng() < 0.8,
          script2Enabled: rng() < 0.6,
          script3Enabled: rng() < 0.4,
          debugMode: rng() < 0.15,
          scriptTitles: ["Audit Script", "Defer Script", "Hide CSS"],
          metaobjectId: `gid://shopify/Metaobject/${randInt(rng, 100000, 999999)}`,
          createdAt: installedAt,
          updatedAt: lastSyncedAt ?? installedAt,
          auditComplete,
          // Extra plan-referenced fields kept alongside (not yet part of
          // the shared StoreConfig type — see the audit-columns note).
          auditDeferArray: shuffleSample(rng, AUDIT_DEFER_SCRIPTS, randInt(rng, 1, 3)),
          auditHideSelectors: shuffleSample(rng, AUDIT_HIDE_SELECTORS, randInt(rng, 1, 3)),
        } as StoreWithConfigs["configs"][number],
      ],
      activities: generateActivities(storeId, name, domain, installedAt, uninstalledAt, rng),
    };

    stores.push(store);
  }

  return stores;
}

function shuffleSample<T>(rng: () => number, arr: T[], n: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

const dummyStores = generateDummyStores(32);

export const DUMMY_ACTIVITIES: StoreActivityType[] = dummyStores
  .flatMap((s) => s.activities)
  .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

// ---------------------------------------------------------------------------
// Public helpers — same shapes as the real `queries.ts` functions.
// ---------------------------------------------------------------------------
export function getAllDummyStores(): DummyStore[] {
  return dummyStores;
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

  filtered.sort((a, b) => b.installedAt.getTime() - a.installedAt.getTime());

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

// ---------------------------------------------------------------------------
// Aggregate helpers (also reused by queries.ts for the real+demo merge)
// ---------------------------------------------------------------------------
export function buildInstallsByDay(
  installDates: Date[],
  since: Date,
): Array<{ date: string; count: number }> {
  const buckets = new Map<string, number>();
  const days = Math.ceil((now - since.getTime()) / day);

  for (let i = 0; i <= days; i++) {
    const d = new Date(since.getTime() + i * day);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }

  for (const date of installDates) {
    if (date.getTime() < since.getTime()) continue;
    const key = date.toISOString().slice(0, 10);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, count]) => ({ date, count }));
}

export function buildCountByKey<T>(
  items: T[],
  keyFn: (item: T) => string,
): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFn(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries()).map(([key, count]) => ({ key, count }));
}
