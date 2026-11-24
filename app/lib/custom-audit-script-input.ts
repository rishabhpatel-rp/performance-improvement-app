import {
  applyHideSelectorHygiene,
  emptyHideTemplateBuckets,
  filterHideTemplateBuckets,
  sanitizeHideSelectorsForStore,
} from "./audit-hide-safety.server.ts";
import { applyFoldPolicy } from "./audit-fold-policy.server.ts";
import type { DiscoveredPages, HiddenAuditResult } from "./audit-core.ts";
import { DEFAULT_DELAY_SCRIPTS, EVERY_TIME_DELAY_MS, FIRST_USER_DELAY_MS } from "./constants.ts";
import { unionTemplateLists, type TemplateListBuckets } from "./template-script-config.ts";
import { buildDeferredScriptSource } from "./script-generator.js";
import { STOREFRONT_ERROR_MONITOR_SNIPPET } from "./storefront-error-monitor.ts";

function emptyBuckets(): TemplateListBuckets {
  return { global: [], home: [], collection: [], product: [] };
}

function asBuckets(value: unknown): TemplateListBuckets {
  if (!value || typeof value !== "object") return emptyBuckets();
  const buckets = value as Partial<TemplateListBuckets>;
  return {
    global: Array.isArray(buckets.global) ? buckets.global : [],
    home: Array.isArray(buckets.home) ? buckets.home : [],
    collection: Array.isArray(buckets.collection) ? buckets.collection : [],
    product: Array.isArray(buckets.product) ? buckets.product : [],
  };
}

function mergedDelay(fromAudit: string[] | undefined): string[] {
  return [...new Set([...DEFAULT_DELAY_SCRIPTS, ...(fromAudit ?? [])])];
}

function patternFor(
  path: string | undefined,
  kind: "home" | "collection" | "product",
  report: HiddenAuditResult,
): string {
  if (!path || kind === "home") return "/";
  let pathname = path;
  try {
    pathname = new URL(path).pathname;
  } catch {
    /* already a path */
  }
  const known = report.pagePatterns?.[pathname] ?? [];
  if (kind === "collection") {
    return known.find((pattern) => pattern !== "/" && pattern.endsWith("/")) ?? `${pathname}/`;
  }
  return known[0] ?? pathname;
}

export function scriptInputFromReport(report: HiddenAuditResult, pages: DiscoveredPages) {
  const defer = asBuckets(report.templateBuckets?.defer);
  if (!report.templateBuckets?.defer) defer.global = report.deferArray ?? [];

  const hygiene = applyHideSelectorHygiene(report.hideSelectors ?? []);
  const foldPolicy = applyFoldPolicy(
    hygiene.hideSelectors,
    report.foldAssertion ?? { ok: true, violations: [], pagesChecked: 0 },
  );
  const hideBuckets = asBuckets(report.templateBuckets?.hide);
  const hide =
    foldPolicy.ok && report.templateBuckets?.hide
      ? filterHideTemplateBuckets(hideBuckets, foldPolicy.hideSelectors)
      : foldPolicy.ok
        ? { ...emptyHideTemplateBuckets(), global: foldPolicy.hideSelectors }
        : emptyHideTemplateBuckets();
  const hideSanitized: TemplateListBuckets = {
    global: sanitizeHideSelectorsForStore(hide.global),
    home: sanitizeHideSelectorsForStore(hide.home),
    collection: sanitizeHideSelectorsForStore(hide.collection),
    product: sanitizeHideSelectorsForStore(hide.product),
  };

  const first = { ...emptyBuckets(), global: mergedDelay(report.delayFirstArray) };
  const every = { ...emptyBuckets(), global: mergedDelay(report.delayEveryArray) };
  const firstMs = {
    home: FIRST_USER_DELAY_MS,
    collection: FIRST_USER_DELAY_MS,
    product: FIRST_USER_DELAY_MS,
  };
  const everyMs = {
    home: EVERY_TIME_DELAY_MS,
    collection: EVERY_TIME_DELAY_MS,
    product: EVERY_TIME_DELAY_MS,
  };

  const pageVariants = (
    [
      ["product", pages.pdp],
      ["collection", pages.plp],
      ["home", pages.home],
    ] as const
  ).map(([scope, path]) => ({
    pattern: patternFor(path, scope, report),
    add: defer[scope],
    hide: hideSanitized[scope],
    first: first[scope],
    every: every[scope],
    firstMs: firstMs[scope],
    everyMs: everyMs[scope],
  }));

  return {
    tabScoped: true as const,
    baseScripts: defer.global,
    pageVariants,
    interactionGatedScripts: unionTemplateLists(defer),
    globalHideSelectors: hideSanitized.global,
    globalFirstVisitDelayedScripts: first.global,
    globalEveryLoadDelayedScripts: every.global,
    hideSelectors: unionTemplateLists(hideSanitized),
    firstVisitDelayedScripts: [],
    everyLoadDelayedScripts: [],
    firstVisitDelayMs: FIRST_USER_DELAY_MS,
    everyLoadDelayMs: EVERY_TIME_DELAY_MS,
    debugMode: false,
  };
}

export function buildReadableScriptForCustomAudit(
  report: HiddenAuditResult,
  pages: DiscoveredPages,
): string {
  return (
    buildDeferredScriptSource(scriptInputFromReport(report, pages)) +
    STOREFRONT_ERROR_MONITOR_SNIPPET
  );
}
