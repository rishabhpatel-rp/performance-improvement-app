import { createHash } from "node:crypto";
import prisma from "../db.server";
import {
  MIN_PER_PAGE_DELTA,
  orderPagePatterns,
  selectPerPageVariants,
} from "./per-page";
import { buildHiddenCss, generateDeferredScript } from "./script-generator";

/**
 * Per-page data from the most recent completed audit.
 *
 * `AuditLog.audit_data` is a `Json` column that already holds the entire
 * report — `saveAuditReport` writes the whole result object into it — so the
 * per-page arrays ride along with no schema change. This reads them back at
 * build time. If there is no usable per-page data (no completed audit yet, or a
 * merchant hand-edited the arrays in Step 3), the caller falls back to the
 * single union in `StoreConfig`, which is exactly today's behaviour.
 */
async function readPerPageAuditData(
  shopDomain: string,
): Promise<{
  baseScripts: string[];
  variants: Array<{ pattern: string; add: string[]; hide: string[] }>;
} | null> {
  try {
    const log = await prisma.auditLog.findFirst({
      where: { domain: shopDomain, status: "completed" },
      orderBy: { timestamp: "desc" },
      select: { audit_data: true },
    });
    const data = log?.audit_data as
      | {
          deferArrayBase?: unknown;
          deferArrayAddByPage?: unknown;
          hideSelectorsByPage?: unknown;
          pagePatterns?: unknown;
        }
      | null
      | undefined;
    if (!data) return null;

    const baseScripts = readStringArray(data.deferArrayBase);
    const adds = data.deferArrayAddByPage;
    const hides = data.hideSelectorsByPage;
    const patterns = data.pagePatterns;
    if (
      !adds ||
      typeof adds !== "object" ||
      !patterns ||
      typeof patterns !== "object"
    ) {
      return null;
    }
    const addMap = adds as Record<string, unknown>;
    const hideMap = (hides || {}) as Record<string, unknown>;
    const patternMap = patterns as Record<string, unknown>;

    // Only SECTION PREFIXES are emitted (e.g. `/products/`, `/collections/`),
    // never the exact audited path. The audit samples one product handle, so
    // `/products/gift-card` is a stand-in for every PDP; giving it its own
    // narrower list would mean a sibling PDP behaves differently from the page
    // that was actually measured. Each prefix therefore carries the union of
    // every audited page that falls under it, which is also the safe direction:
    // a script is gated on a sibling page only if it was measured somewhere
    // under that prefix.
    //
    // Ordered most specific first, with "/" last as the catch-all. Two pages can
    // produce the same prefix (home and the PLP both produce "/"), so their
    // contents are unioned.
    const ordered: string[] = [];
    for (const page of Object.keys(patternMap)) {
      ordered.push(...readStringArray(patternMap[page]));
    }
    // "/" sorts last or it shadows every real prefix.
    const candidates = orderPagePatterns(ordered).map((pattern) => {
      const add = new Set<string>();
      const hide = new Set<string>();
      for (const page of Object.keys(patternMap)) {
        if (!readStringArray(patternMap[page]).includes(pattern)) continue;
        readStringArray(addMap[page]).forEach((x) => add.add(x));
        readStringArray(hideMap[page]).forEach((x) => hide.add(x));
      }
      return { pattern, add: [...add], hide: [...hide] };
    });

    // A per-page variant is only worth its bytes when the delta is a real one.
    //
    // Every variant a bundle carries is paid for by EVERY page load, and the
    // measured deltas are small: on a real store home was base+6, PLP base+2,
    // PDP base+4. A variant holding one or two extra tokens costs more in
    // payload on every page than it saves in gating, so those prefixes are
    // dropped and their pages fall through to the union — which is the
    // behaviour they had before per-page data existed, and is the safe
    // direction (a superset of what the page would have gated).
    //
    // Hides are exempt: `hide` selectors are per-page value that the union
    // cannot express, and they are not part of the per-page script payload.
    const variants = selectPerPageVariants(candidates);
    if (variants.length !== candidates.length) {
      console.log(
        `[perf] per-page threshold ${MIN_PER_PAGE_DELTA}: kept ${variants.length}/${candidates.length} ` +
          `variants, dropped ${candidates
            .filter((v) => !variants.includes(v))
            .map((v) => v.pattern)
            .join(", ")} (union fallback)`,
      );
    }

    if (variants.length === 0) return null;
    return { baseScripts, variants };
  } catch {
    // A malformed report must never break the build; the union fallback covers it.
    return null;
  }
}

/**
 * Safely coerce a Prisma `Json` value (or any unknown) into a string array.
 * Returns `[]` when the value is not a JSON array of strings. Avoids
 * trusting raw `JsonValue` from the DB.
 */
export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

export interface BuiltPerformanceScript {
  deferScript: string; // final obfuscated JS ("" when the app is off)
  hiddenCss: string;
  scriptHash: string;
  scriptBuiltAt: Date;
}

/**
 * Obfuscation is CPU-heavy (~0.7 s), so it runs here — once, whenever the
 * inputs change — and the result is stored in `PerformanceScript.deferScript`.
 * The storefront proxy route only reads that column.
 *
 * Inputs mirror the Step 2 cards: each list only counts while its own
 * `*Enabled` toggle is ON. Returns the row, or null when the store is unknown
 * or the build fails (failures are logged, never thrown, so callers such as
 * "save audit arrays" don't fail because of a rebuild; the proxy route
 * lazily rebuilds a missing script).
 */
export async function rebuildPerformanceScript(
  shopDomain: string,
): Promise<BuiltPerformanceScript | null> {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
      include: { configs: { orderBy: { updatedAt: "desc" }, take: 1 } },
    });
    if (!store) return null;

    const config = store.configs[0];
    const active = store.isActive && Boolean(config?.appEnabled);

    let deferScript = "";
    let hiddenCss = "";

    if (active && config) {

      // The toggle must win over per-page data: when deferral is switched off
      // nothing may be gated, so per-page lists are only read when it is on.
      const deferEnabled = config.auditDeferArrayEnabled !== false;
      const perPage = deferEnabled ? await readPerPageAuditData(shopDomain) : null;
      const hideEnabled = config.auditHideSelectorsEnabled;

      deferScript = generateDeferredScript({
        // `baseScripts` is what every audited page loads and is only consulted
        // when a page variant matches; `interactionGatedScripts` is the union
        // used for an un-audited page (a blog post, a search result). With no
        // per-page data the variant list is empty, so every page uses the union
        // — the pre-existing behaviour.
        baseScripts: perPage?.baseScripts ?? [],
        pageVariants: perPage?.variants ?? [],
        interactionGatedScripts: deferEnabled
          ? readStringArray(config.auditDeferArray)
          : [],
        firstVisitDelayedScripts: config.firstUserDelayScriptsEnabled
          ? readStringArray(config.firstUserDelayScripts)
          : [],
        everyLoadDelayedScripts: config.staticDeferDefaultsEnabled
          ? readStringArray(config.staticDeferDefaults)
          : [],
        firstVisitDelayMs: config.firstUserDelayMs ?? 12000,
        everyLoadDelayMs: config.everyTimeDelayMs ?? 6000,
        hideSelectors: hideEnabled ? readStringArray(config.auditHideSelectors) : [],
        // Settings "Debug mode": keep console logging in the storefront bundle.
        debugMode: config.debugMode === true,
      });

      hiddenCss = hideEnabled ? buildHiddenCss(readStringArray(config.auditHideSelectors)) : "";
    }

    const built: BuiltPerformanceScript = {
      deferScript,
      hiddenCss,
      scriptHash: createHash("sha256").update(deferScript).digest("hex"),
      scriptBuiltAt: new Date(),
    };

    await prisma.performanceScript.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id, ...built },
      update: built,
    });

    return built;
  } catch (err) {
    console.error(
      `[performance-script] Rebuild failed for ${shopDomain}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
