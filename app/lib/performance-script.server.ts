import { createHash } from "node:crypto";
import prisma from "../db.server";
import {
  MIN_PER_PAGE_DELTA,
  orderPagePatterns,
  selectPerPageVariants,
} from "./per-page";
import { templateDeferToPageVariants } from "./audit-template-buckets";
import {
  auditDeferColumn,
  auditHideColumn,
  everyTimeDelayMsColumn,
  firstUserDelayColumn,
  firstUserDelayMsColumn,
  readBucketsFromRow,
  staticDeferColumn,
  type TemplateScope,
  unionTemplateLists,
  TEMPLATE_SCOPES,
} from "./template-script-config";
import {
  buildHiddenCss,
  buildRawScript,
  fingerprintRawScript,
  obfuscateRawScript,
} from "./script-generator";
import { hashScript, seedFromShop } from "./script-inline";
import { syncScriptMetafield } from "./script-metafield.server";

function patternScope(pattern: string): TemplateScope {
  if (pattern === "/products/") return "product";
  if (pattern === "/collections/") return "collection";
  return "home";
}

function readTemplatePayloadFromConfig(config: Record<string, unknown>) {
  const deferBuckets = readBucketsFromRow(config, auditDeferColumn, "auditDeferArray");
  const hideBuckets = readBucketsFromRow(config, auditHideColumn, "auditHideSelectors");
  const firstBuckets = readBucketsFromRow(
    config,
    firstUserDelayColumn,
    "firstUserDelayScripts",
  );
  const staticBuckets = readBucketsFromRow(
    config,
    staticDeferColumn,
    "staticDeferDefaults",
  );
  const hasTemplate = TEMPLATE_SCOPES.some((s) => deferBuckets[s].length > 0);
  if (!hasTemplate) return null;

  const variants = selectPerPageVariants(
    templateDeferToPageVariants(deferBuckets, hideBuckets).map((v) => {
      const scope = patternScope(v.pattern);
      return {
        pattern: v.pattern,
        add: v.add,
        hide: v.hide,
        firstUserAdd: firstBuckets[scope],
        everyAdd: staticBuckets[scope],
        firstUserDelayMs:
          (config[firstUserDelayMsColumn(scope)] as number | undefined) ??
          (config.firstUserDelayMs as number | undefined),
        everyLoadDelayMs:
          (config[everyTimeDelayMsColumn(scope)] as number | undefined) ??
          (config.everyTimeDelayMs as number | undefined),
      };
    }),
  );
  return { baseScripts: deferBuckets.global, variants, deferBuckets, firstBuckets };
}

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
          templateBuckets?: {
            defer?: {
              global?: unknown;
              home?: unknown;
              collection?: unknown;
              product?: unknown;
            };
          };
        }
      | null
      | undefined;
    if (!data) return null;

    const templateDefer = data.templateBuckets?.defer;
    if (templateDefer) {
      const buckets = {
        global: readStringArray(templateDefer.global),
        home: readStringArray(templateDefer.home),
        collection: readStringArray(templateDefer.collection),
        product: readStringArray(templateDefer.product),
      };
      const variants = selectPerPageVariants(
        templateDeferToPageVariants(buckets).map((v) => ({ ...v, hide: [] })),
      );
      if (buckets.global.length || variants.length) {
        return { baseScripts: buckets.global, variants };
      }
    }

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

/** `inputsHash` stored while the app is off (no script is built at all). */
const OFF_FINGERPRINT = "off";

/**
 * Obfuscation is CPU-heavy (~0.7 s), so it runs here — once, whenever the
 * inputs change — and the result is stored in `PerformanceScript.deferScript`.
 *
 * "Inputs changed" is decided by a fingerprint of the RAW script source plus the
 * obfuscation profile, debug flag and seed (`fingerprintRawScript`). The raw
 * source already contains every list, delay and selector, so an unchanged
 * fingerprint means the stored obfuscated script is exactly what a rebuild would
 * produce, and obfuscation is skipped. Saving an unchanged config therefore
 * costs a string template, not an obfuscation run.
 *
 * After storing, the script is mirrored into the shop metafield that the theme
 * app embed renders inline (`syncScriptMetafield`). The proxy route
 * (`api.storefront-scripts`) only reads the DB column and remains the fallback.
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
      include: {
        configs: { orderBy: { updatedAt: "desc" }, take: 1 },
        performanceScript: {
          select: {
            inputsHash: true,
            deferScript: true,
            hiddenCss: true,
            scriptHash: true,
            scriptBuiltAt: true,
          },
        },
      },
    });
    if (!store) return null;

    const config = store.configs[0];
    const existing = store.performanceScript;
    const active = store.isActive && Boolean(config?.appEnabled);

    let deferScript = "";
    let hiddenCss = "";
    let inputsHash = OFF_FINGERPRINT;
    let reused = false;

    if (active && config) {

      // The toggle must win over per-page data: when deferral is switched off
      // nothing may be gated, so per-page lists are only read when it is on.
      const deferEnabled = config.auditDeferArrayEnabled !== false;
      const templatePayload = readTemplatePayloadFromConfig(
        config as Record<string, unknown>,
      );
      const perPage =
        deferEnabled && templatePayload
          ? templatePayload
          : deferEnabled
            ? await readPerPageAuditData(shopDomain)
            : null;
      const hideEnabled = config.auditHideSelectorsEnabled;
      const debugMode = config.debugMode === true;
      const seed = seedFromShop(shopDomain);

      const deferUnion = templatePayload
        ? unionTemplateLists(templatePayload.deferBuckets)
        : readStringArray(config.auditDeferArray);

      const rawScript = buildRawScript({
        baseScripts: perPage?.baseScripts ?? [],
        pageVariants: perPage?.variants ?? [],
        interactionGatedScripts: deferEnabled ? deferUnion : [],
        firstVisitDelayedScripts:
          config.firstUserDelayScriptsEnabled !== false
            ? (templatePayload?.firstBuckets.global ??
              readStringArray(config.firstUserDelayScripts))
            : [],
        everyLoadDelayedScripts:
          config.staticDeferDefaultsEnabled !== false
            ? readBucketsFromRow(
                config as Record<string, unknown>,
                staticDeferColumn,
                "staticDeferDefaults",
              ).global
            : [],
        firstVisitDelayMs:
          config.firstUserDelayMsGlobal ??
          config.firstUserDelayMs ??
          12000,
        everyLoadDelayMs:
          config.everyTimeDelayMsGlobal ??
          config.everyTimeDelayMs ??
          6000,
        hideSelectors: hideEnabled ? readStringArray(config.auditHideSelectors) : [],
      });

      inputsHash = fingerprintRawScript(rawScript, { debugMode, seed });

      if (existing?.deferScript && existing.inputsHash === inputsHash) {
        // Identical script: keep the stored obfuscated bytes (no CPU work).
        deferScript = existing.deferScript;
        reused = true;
        console.log(
          `[perf] ${shopDomain}: script inputs unchanged, skipped obfuscation`,
        );
      } else {
        // Settings "Debug mode": keep console logging in the storefront bundle.
        deferScript = obfuscateRawScript(rawScript, { debugMode, seed });
      }

      hiddenCss = hideEnabled ? buildHiddenCss(readStringArray(config.auditHideSelectors)) : "";
    } else if (existing && existing.inputsHash === OFF_FINGERPRINT) {
      reused = true; // already stored as "off"; nothing to rebuild
    }

    const built: BuiltPerformanceScript = reused && existing
      ? {
          deferScript,
          hiddenCss,
          scriptHash: existing.scriptHash ?? hashScript(deferScript),
          scriptBuiltAt: existing.scriptBuiltAt ?? new Date(),
        }
      : {
          deferScript,
          hiddenCss,
          scriptHash: hashScript(deferScript),
          scriptBuiltAt: new Date(),
        };

    if (!reused) {
      await prisma.performanceScript.upsert({
        where: { storeId: store.id },
        create: { storeId: store.id, ...built, inputsHash },
        update: { ...built, inputsHash },
      });
    }

    // Mirror into the shop metafield (write / clear / no-op as needed). Never
    // throws; a failure is healed by reconcileScriptMetafield.
    await syncScriptMetafield(shopDomain);

    return built;
  } catch (err) {
    console.error(
      `[performance-script] Rebuild failed for ${shopDomain}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
