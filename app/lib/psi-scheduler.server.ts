import prisma from "../db.server";
import {
  appendStorefrontPassword,
  fetchPsiLighthouse,
  PSI_SKIP_PASSWORD_STORE_NOTE,
  shouldSkipPsiFetch,
  type PsiLighthouseReport,
} from "./psi.server";
import type { FieldVitalsSummary, PageSpeedPageView } from "./audit-report-types";

const MIN_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function jitterMs(shopDomain: string): number {
  let h = 0;
  for (let i = 0; i < shopDomain.length; i++) h = (h * 31 + shopDomain.charCodeAt(i)) | 0;
  return Math.abs(h % (12 * 60 * 60 * 1000));
}

export function schedulePsiAfterAudit(
  shopDomain: string,
  pageUrls: string[],
  storefrontPassword?: string | null,
): void {
  void runPsiJob(shopDomain, pageUrls, storefrontPassword).catch((err) => {
    console.warn("[psi] job failed:", err instanceof Error ? err.message : err);
  });
}

/** Await PSI fetch (used by refresh script and tests). Clears throttle when `force` is true. */
export async function refreshPsiForShop(
  shopDomain: string,
  pageUrls: string[],
  storefrontPassword?: string | null,
  { force = false }: { force?: boolean } = {},
) {
  if (force) {
    await prisma.storeConfig.updateMany({
      where: { store: { shopDomain } },
      data: { psiLastFetchedAt: null, psiBackoffUntil: null },
    });
  }
  await runPsiJob(shopDomain, pageUrls, storefrontPassword);
}

async function runPsiJob(
  shopDomain: string,
  pageUrls: string[],
  storefrontPassword?: string | null,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      id: true,
      configs: {
        select: {
          psiLastFetchedAt: true,
          psiBackoffUntil: true,
          storefrontPassword: true,
          isPasswordProtected: true,
        },
      },
    },
  });
  const sc = store?.configs?.[0];
  const password = storefrontPassword ?? sc?.storefrontPassword ?? null;

  if (shouldSkipPsiFetch(sc?.isPasswordProtected)) {
    console.log(`[psi] skipped for ${shopDomain} — password-protected storefront`);
    await persistFieldVitals(shopDomain, {
      source: "none",
      note: PSI_SKIP_PASSWORD_STORE_NOTE,
      fetchedAt: new Date().toISOString(),
    });
    return;
  }

  if (sc?.psiBackoffUntil && sc.psiBackoffUntil.getTime() > Date.now()) {
    return;
  }
  if (sc?.psiLastFetchedAt) {
    const next = sc.psiLastFetchedAt.getTime() + MIN_INTERVAL_MS + jitterMs(shopDomain);
    if (Date.now() < next) return;
  }

  const bases = pageUrls.filter((u) => u.startsWith("https://")).slice(0, 3);
  if (!bases.length) return;

  let lastField: FieldVitalsSummary | null = null;

  for (const base of bases) {
    const url = appendStorefrontPassword(base, password);
    for (const strategy of ["mobile", "desktop"] as const) {
      const field: PsiLighthouseReport = await fetchPsiLighthouse(url, strategy);
      if (field.source === "none") {
        if (field.backoffUntil) {
          await persistFieldVitals(shopDomain, field);
          return;
        }
        lastField = field;
        continue;
      }
      await prisma.psiSnapshot.create({
        data: {
          shopDomain,
          url: base,
          strategy,
          fieldSource: field.source,
          lcp: field.lcp ?? null,
          inp: field.inp ?? null,
          cls: field.cls != null ? Math.round(field.cls * (field.cls < 1 ? 1000 : 1)) : null,
          lighthouseScore: field.lighthouseScore ?? field.categories?.performance ?? null,
          rawJson: { ...field },
          fetchedAt: field.fetchedAt ? new Date(field.fetchedAt) : new Date(),
        },
      });
      if (field.backoffUntil) {
        await persistFieldVitals(shopDomain, field);
        return;
      }
      if (strategy === "mobile") lastField = field;
    }
  }

  if (lastField) {
    await persistFieldVitals(shopDomain, lastField);
  }
}

async function persistFieldVitals(shopDomain: string, field: FieldVitalsSummary) {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) return;
  const backoff = field.backoffUntil ? new Date(field.backoffUntil) : null;

  await prisma.storeConfig.updateMany({
    where: { storeId: store.id },
    data: {
      psiFieldVitals: field,
      psiLastFetchedAt: field.fetchedAt ? new Date(field.fetchedAt) : new Date(),
      psiBackoffUntil: backoff,
    },
  });
}

export async function loadPsiSnapshotsForShop(shopDomain: string, limit = 24) {
  return prisma.psiSnapshot.findMany({
    where: { shopDomain },
    orderBy: { fetchedAt: "desc" },
    take: limit,
  });
}

/** Latest PSI row per path + strategy for Step 3 Overview. */
export function buildPageSpeedViews(
  pages: Array<{ label: string; path: string }>,
  snapshots: Awaited<ReturnType<typeof loadPsiSnapshotsForShop>>,
): PageSpeedPageView[] {
  const latest = new Map<string, (typeof snapshots)[0]>();
  for (const row of snapshots) {
    let pathname = row.url;
    try {
      pathname = new URL(row.url).pathname || "/";
    } catch {
      /* keep raw */
    }
    const key = `${normalizePath(pathname)}|${row.strategy}`;
    if (!latest.has(key)) latest.set(key, row);
  }

  return pages.map((p) => {
    const mobileKey = `${normalizePath(p.path)}|mobile`;
    const desktopKey = `${normalizePath(p.path)}|desktop`;
    const mobileRow = latest.get(mobileKey);
    const desktopRow = latest.get(desktopKey);
    return {
      label: p.label,
      path: p.path,
      mobile: rowToLh(mobileRow),
      desktop: rowToLh(desktopRow),
    };
  });
}

function normalizePath(path: string) {
  return path || "/";
}

function rowToLh(row?: (Awaited<ReturnType<typeof loadPsiSnapshotsForShop>>)[0]) {
  if (!row?.rawJson || typeof row.rawJson !== "object") {
    if (!row) return undefined;
    return {
      source: "psi" as const,
      categories: {
        performance: row.lighthouseScore ?? undefined,
      },
      metrics: {
        lcpSec: row.lcp != null ? row.lcp / 1000 : undefined,
      },
      note: row.fieldSource === "none" ? "PSI unavailable for this URL" : undefined,
    };
  }
  const raw = row.rawJson as {
    categories?: import("./audit-report-types").LighthouseUiScores;
    metrics?: import("./audit-report-types").LighthouseUiMetrics;
    note?: string;
    source?: string;
  };
  return {
    source: "psi" as const,
    categories: raw.categories,
    metrics: raw.metrics,
    note: raw.note,
  };
}
