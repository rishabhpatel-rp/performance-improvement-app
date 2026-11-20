/** Pure assembly helpers extracted from the dashboard loader so the route stays
 *  a thin orchestration layer. Same behaviour, no duplicated Store queries. */

import { auditProgressPercent } from "./audit-lifecycle.ts";
import { auditErrorUserMessage } from "./audit-user-messages.server.ts";
import {
  DEFAULT_DELAY_SCRIPTS,
  FIRST_USER_DELAY_MS,
  EVERY_TIME_DELAY_MS,
  DASHBOARD_STALE_MS,
} from "./constants.ts";
import { readStringArray } from "./dashboard-loader-core.ts";
import { TEMPLATE_SCOPES, type TemplateScope } from "./template-script-config.ts";

export type QueueSnapshot = {
  depth: number;
  runningCount: number;
  queuePosition: number | null;
  shopsAhead: number;
  estimatedWaitMinutes: number | null;
} | null;

export function readAuditPages(
  value: unknown,
): Array<{ label: string; path: string; done?: boolean }> {
  if (!Array.isArray(value)) return [];
  const pages: Array<{ label: string; path: string; done?: boolean }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { label, path, done } = item as Record<string, unknown>;
    if (typeof label === "string" && typeof path === "string") {
      pages.push({ label, path, ...(done === true ? { done: true } : {}) });
    }
  }
  return pages;
}

export function needsShopifyRefresh(
  store: { isActive?: boolean; lastSyncedAt?: Date | null } | null,
  url: string,
  endpoint: string,
  cachedEndpoint?: string | null,
  now = Date.now(),
): boolean {
  if (!store?.isActive) return true;
  if (store.lastSyncedAt && now - store.lastSyncedAt.getTime() > DASHBOARD_STALE_MS) return true;
  if (url.includes("?refresh=1")) return true;
  return Boolean(endpoint && cachedEndpoint && cachedEndpoint !== endpoint);
}

export function buildAuditStatus(
  sc: Record<string, unknown> | null | undefined,
  queue: QueueSnapshot,
) {
  if (!sc) {
    return {
      running: false,
      complete: false,
      failed: false,
      error: null,
      errorMessage: null,
      pageIndex: 0,
      totalPages: 0,
      progress: 0,
      pages: [],
      pageStartedAt: null,
      phase: null,
      queue: null,
      serverNow: Date.now(),
    };
  }
  const pageIndex = typeof sc.auditPageIndex === "number" ? sc.auditPageIndex : 0;
  const totalPages = typeof sc.auditTotalPages === "number" ? sc.auditTotalPages : 0;
  const started = sc.auditPageStartedAt as Date | null | undefined;
  return {
    running: Boolean(sc.auditRunning),
    complete: Boolean(sc.auditComplete),
    failed: Boolean(sc.auditFailed),
    error: (sc.auditError as string | null) ?? null,
    errorMessage: auditErrorUserMessage(sc.auditError as string | null),
    pageIndex,
    totalPages,
    progress: auditProgressPercent(pageIndex, totalPages),
    pages: readAuditPages(sc.auditPages),
    pageStartedAt: started ? started.toISOString() : null,
    phase: (sc.auditPhase as string | null) ?? null,
    queue,
    serverNow: Date.now(),
  };
}

export function buildFinalConfig(
  mergedConfig: Record<string, unknown>,
  sc: Record<string, unknown> | null | undefined,
  templateConfig: Record<string, unknown>,
) {
  const firstUser = readStringArray(sc?.firstUserDelayScripts);
  const preserved = readStringArray(sc?.firstUserDelayScriptsPreserved);
  const dbDefer = readStringArray(sc?.auditDeferArray);
  const dbHide = readStringArray(sc?.auditHideSelectors);
  const dbStatic = readStringArray(sc?.staticDeferDefaults);
  const auditHasRun = Boolean(sc?.lastAuditAt);
  return {
    ...mergedConfig,
    auditDeferArray:
      auditHasRun || dbDefer.length ? dbDefer : readStringArray(mergedConfig.auditDeferArray),
    auditHideSelectors:
      auditHasRun || dbHide.length ? dbHide : readStringArray(mergedConfig.auditHideSelectors),
    staticDeferDefaults: dbStatic.length ? dbStatic : [...DEFAULT_DELAY_SCRIPTS],
    auditDeferArrayEnabled: (sc?.auditDeferArrayEnabled as boolean) ?? true,
    auditHideSelectorsEnabled: (sc?.auditHideSelectorsEnabled as boolean) ?? true,
    staticDeferDefaultsEnabled: (sc?.staticDeferDefaultsEnabled as boolean) ?? true,
    auditDeferArrayPreserved: readStringArray(sc?.auditDeferArrayPreserved),
    auditHideSelectorsPreserved: readStringArray(sc?.auditHideSelectorsPreserved),
    staticDeferDefaultsPreserved: readStringArray(sc?.staticDeferDefaultsPreserved),
    hasStorefrontPassword: Boolean(sc?.storefrontPassword),
    customPlpUrl: (sc?.customPlpUrl as string) || "",
    customPdpUrl: (sc?.customPdpUrl as string) || "",
    customPageUrls: readStringArray(sc?.customPageUrls),
    firstUserDelayScripts: firstUser.length ? firstUser : [...DEFAULT_DELAY_SCRIPTS],
    firstUserDelayScriptsEnabled: (sc?.firstUserDelayScriptsEnabled as boolean) ?? true,
    firstUserDelayScriptsPreserved: preserved.length ? preserved : [],
    firstUserDelayMs: (sc?.firstUserDelayMs as number) ?? FIRST_USER_DELAY_MS,
    everyTimeDelayMs: (sc?.everyTimeDelayMs as number) ?? EVERY_TIME_DELAY_MS,
    adminManaged: sc?.adminManaged === true,
    onboardingActivated: sc?.onboardingActivated === true,
    ...templateConfig,
  };
}

export function isTemplateScope(value: unknown): value is TemplateScope {
  return typeof value === "string" && (TEMPLATE_SCOPES as readonly string[]).includes(value);
}
