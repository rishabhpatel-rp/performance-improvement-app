import { mergeSlugVariants, pageMatchPatterns } from "./audit-candidates";
import { buildScriptInventory } from "./audit-inventory.server";
import { measureGateImpactOnHome } from "./audit-gate-impact.server";
import {
  buildTemplateDeferBuckets,
  buildTemplateListBuckets,
} from "./audit-template-buckets";
import {
  withBrowser,
  type DiscoveredPages,
  type HiddenAuditResult,
  type AuditProgress,
  type PageFunnel,
  AuditBlockedError,
  safePathname,
  pageRolesFromDiscovery,
} from "./audit-core.server";
import {
  AUDIT_PASS_GAP_MS,
  AUDIT_REPEAT_PASSES,
  collapseToParentSelectors,
  measurePage,
  popupSelectorsSafeOnPage,
  selectorsOverlapFoldOnPage,
  selectorsVisibleOnPage,
  verifyFoldSurvives,
  type MeasuredPage,
} from "./audit-run-page-measure.server";

async function readPriorDeferTokens(shopDomain: string): Promise<string[]> {
  try {
    const { default: prisma } = await import("../db.server");
    const log = await prisma.auditLog.findFirst({
      where: { domain: shopDomain },
      orderBy: { timestamp: "desc" },
      select: { audit_data: true },
    });
    const data = log?.audit_data as
      | { deferArray?: unknown; deferArrayUnmerged?: unknown }
      | null;
    if (!data) return [];
    const pick = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return [...new Set([...pick(data.deferArrayUnmerged), ...pick(data.deferArray)])];
  } catch (err) {
    console.warn("[audit] could not read the previous report:", err);
    return [];
  }
}

export async function runHiddenAudit({
  pages,
  password,
  shopDomain,
  onProgress,
}: {
  pages: DiscoveredPages;
  shopDomain?: string;
  password?: string;
  onProgress?: (progress: AuditProgress) => void | Promise<void>;
}): Promise<HiddenAuditResult> {
  const urls = [pages.home, pages.plp, pages.pdp, ...(pages.extras ?? [])].filter(
    (u): u is string => Boolean(u),
  );

  let done = 0;
  await onProgress?.({ done, total: urls.length });

  const auditStarted = Date.now();
  return withBrowser(async (browser) => {
    const measuredAll: MeasuredPage[] = [];
    const measured: MeasuredPage[] = [];
    const seenPaths = new Set<string>();
    let passesRun = 0;
    let lastPassTokenKey = "";
    let stablePassStreak = 0;
    try {
      for (let pass = 0; pass < AUDIT_REPEAT_PASSES; pass++) {
        passesRun = pass + 1;
        const settled = await Promise.allSettled(
          urls.map(async (url) => {
            const m = await measurePage(browser, url, password, pass > 0);
            measuredAll.push(m);
            let path: string | undefined;
            try {
              path = new URL(url).pathname || "/";
            } catch {
              path = url;
            }
            if (!seenPaths.has(path)) {
              seenPaths.add(path);
              measured.push(m);
            }
            done++;
            try {
              await onProgress?.({
                done,
                total: urls.length * AUDIT_REPEAT_PASSES,
                path,
                pass,
                waitMs: m.acc?.settle?.postInteractionWaitMs,
                scripts: m.acc?.sources?.request,
                emitted: m.acc?.p?.length,
              });
            } catch {
              // progress is best-effort
            }
          }),
        );
        const passFailed = measuredAll.length < (pass + 1) * urls.length;
        if (passFailed && pass === 0) {
          const failure = settled.find((r) => r.status === "rejected");
          throw failure && failure.status === "rejected"
            ? failure.reason
            : new Error("No pages could be audited.");
        }
        const passTokens = new Set<string>();
        for (const m of measuredAll.slice(-urls.length)) {
          m.acc.p.forEach((t) => passTokens.add(t));
        }
        const passKey = [...passTokens].sort().join("|");
        if (pass > 0 && passKey === lastPassTokenKey) {
          stablePassStreak++;
          if (stablePassStreak >= 2) break;
        } else {
          stablePassStreak = 0;
        }
        lastPassTokenKey = passKey;

        if (pass < AUDIT_REPEAT_PASSES - 1 && stablePassStreak < 2) {
          await new Promise((r) => setTimeout(r, AUDIT_PASS_GAP_MS));
        }
      }
      if (measured.some((m) => m.blocked)) {
        throw new AuditBlockedError(
          password ? "PASSWORD_INCORRECT" : "PASSWORD_REQUIRED",
        );
      }
      if (measured.length === 0) {
        throw new Error("No pages could be audited.");
      }

      const pSet = new Set<string>();
      const visSet = new Set<string>();
      const offSet = new Set<string>();
      const foldRequiredScripts = new Set<string>();
      const foldReasons: Record<string, string> = {};
      const coverageRan = new Set<string>();
      const coverageUnknown = new Set<string>();
      const neverDefer = new Set<string>();
      const noise = new Set<string>();
      const selfScripts = new Set<string>();
      const funnel: PageFunnel[] = [];
      for (const { acc } of measuredAll) {
        acc.p.forEach((x) => pSet.add(x));
        acc.vis.forEach((x) => visSet.add(x));
        acc.off.forEach((x) => offSet.add(x));
        acc.foldScripts.forEach((x) => foldRequiredScripts.add(x));
        Object.entries(acc.foldReasons).forEach(([k, v]) => {
          if (!foldReasons[k]) foldReasons[k] = v;
        });
        acc.coverageRan.forEach((x) => coverageRan.add(x));
        acc.coverageUnknown.forEach((x) => coverageUnknown.add(x));
        acc.neverDefer.forEach((x) => neverDefer.add(x));
        acc.noise.forEach((x) => noise.add(x));
        acc.selfScripts.forEach((x) => selfScripts.add(x));
        funnel.push({
          request: acc.sources.request,
          dom: acc.sources.dom,
          resourceTiming: acc.sources.resourceTiming,
          requestOnly: acc.sources.requestOnly,
          disagreement: acc.sources.disagreement,
          candidates: acc.p.length,
          neverDefer: acc.neverDefer.length,
          noise: acc.noise.length,
          selfExcluded: acc.selfScripts.length,
          foldProtected: acc.foldScripts.length,
          coverageRan: acc.coverageRan.length,
          coverageUnknown: acc.coverageUnknown.length,
          emitted: acc.p.filter(
            (x) =>
              !acc.foldScripts.includes(x) &&
              !acc.coverageRan.includes(x) &&
              !acc.coverageUnknown.includes(x),
          ).length,
          settle: acc.settle,
        });
      }

      const offList = [...offSet];
      const visibleHits = await Promise.all(
        measured.map(({ page }) => selectorsVisibleOnPage(page, offList)),
      );
      visibleHits.forEach((hits) => hits.forEach((x) => visSet.add(x)));

      const foldHits = await Promise.all(
        measured.map(({ page }) => selectorsOverlapFoldOnPage(page, offList)),
      );
      foldHits.forEach((hits) => hits.forEach((x) => visSet.add(x)));

      const crossPageFoldOnly = await Promise.all(
        measured.map(({ page }) => selectorsOverlapFoldOnPage(page, offList)),
      );
      const foldProtectedSelectors = new Set<string>();
      crossPageFoldOnly.forEach((hits) => hits.forEach((x) => foldProtectedSelectors.add(x)));

      const hideCandidates = offList.filter(
        (x) => !visSet.has(x) && !foldProtectedSelectors.has(x),
      );

      const collapsedSelectors = await Promise.all(
        measured.map(({ page }) => collapseToParentSelectors(page, hideCandidates)),
      );
      const selectorSet = new Set<string>();
      for (const list of collapsedSelectors) list.forEach((s) => selectorSet.add(s));
      for (const s of selectorSet) {
        if (foldProtectedSelectors.has(s) || visSet.has(s)) selectorSet.delete(s);
      }
      const baseHideSelectors = [...selectorSet].sort();

      const popupCandidates = new Set<string>();
      for (const { acc } of measuredAll) acc.popups.forEach((x) => popupCandidates.add(x));
      const popupCandidateList = [...popupCandidates];
      const popupSafety = await Promise.all(
        measured.map(({ page }) => popupSelectorsSafeOnPage(page, popupCandidateList)),
      );
      const popupSelectors = popupCandidateList
        .filter((sel) => popupSafety.every((safe) => safe.includes(sel)))
        .sort();
      const popupRejected = popupCandidateList.filter((x) => !popupSelectors.includes(x));
      if (popupCandidateList.length) {
        console.log(
          `[audit] popups: ${popupSelectors.length} hidden until interaction` +
            (popupRejected.length
              ? `, ${popupRejected.length} rejected as unsafe (${popupRejected.slice(0, 5).join(", ")})`
              : ""),
        );
      }
      const popupSelectorsByPage: Record<string, string[]> = {};
      measured.forEach((m, i) => {
        popupSelectorsByPage[safePathname(urls[i])] = [
          ...new Set(m.acc.popups.filter((x) => popupSelectors.includes(x))),
        ].sort();
      });

      const hideSelectors = baseHideSelectors;
      const emittedHideSelectors = [...new Set([...hideSelectors, ...popupSelectors])].sort();

      const hideSelectorsByPage: Record<string, string[]> = {};
      const pagePatterns: Record<string, string[]> = {};
      measured.forEach((m, i) => {
        const path = safePathname(urls[i]);
        const local = new Set<string>();
        for (const list of collapsedSelectors[i]) {
          if (foldProtectedSelectors.has(list) || visSet.has(list)) continue;
          local.add(list);
        }
        hideSelectorsByPage[path] = [...local].sort();
        pagePatterns[path] = pageMatchPatterns(path);
      });

      const emittedRaw = [...pSet].filter(
        (x) =>
          !foldRequiredScripts.has(x) &&
          !coverageRan.has(x) &&
          !coverageUnknown.has(x) &&
          !selfScripts.has(x) &&
          !neverDefer.has(x),
      );

      const deferArrayByPage: Record<string, string[]> = {};
      measured.forEach((m, i) => {
        const acc = m.acc;
        deferArrayByPage[safePathname(urls[i])] = acc.p
          .filter(
            (x) =>
              !acc.foldScripts.includes(x) &&
              !acc.coverageRan.includes(x) &&
              !acc.coverageUnknown.includes(x) &&
              !acc.selfScripts.includes(x) &&
              !acc.neverDefer.includes(x),
          )
          .sort();
      });

      const foldAssertion = await verifyFoldSurvives(measured, hideSelectors);

      const pageKeys = Object.keys(deferArrayByPage);
      let baseScripts: Set<string> = new Set<string>();
      if (pageKeys.length > 0) {
        baseScripts = new Set(deferArrayByPage[pageKeys[0]]);
        for (const k of pageKeys.slice(1)) {
          const onPage = new Set(deferArrayByPage[k]);
          baseScripts = new Set([...baseScripts].filter((x) => onPage.has(x)));
        }
      }
      const deferArrayAddByPage: Record<string, string[]> = {};
      for (const k of pageKeys) {
        deferArrayAddByPage[k] = deferArrayByPage[k].filter((x) => !baseScripts.has(x));
      }

      const pageRoles = pageRolesFromDiscovery(pages);

      console.log(
        `[audit] funnel ${JSON.stringify(
          {
            foldAssertion: foldAssertion.ok ? "pass" : `FAIL:${foldAssertion.violations.length}`,
            pages: funnel.map((f) => ({
              request: f.request,
              dom: f.dom,
              rt: f.resourceTiming,
              requestOnly: f.requestOnly,
              disagreement: f.disagreement,
              kept: f.candidates,
              neverDefer: f.neverDefer,
              noise: f.noise,
              self: f.selfExcluded,
              fold: f.foldProtected,
              covRan: f.coverageRan,
              covUnknown: f.coverageUnknown,
              emitted: f.emitted,
              lastScriptMs: f.settle.lastScriptResponseEnd,
              postInteractionDelta: f.settle.postInteractionDelta,
              scrollSteps: f.settle.scrollSteps,
              clicks: f.settle.clicks,
              safetyNet: f.settle.hitSafetyNet,
            })),
            emittedTotal: emittedRaw.length,
            hideSelectors: hideSelectors.length,
            popupSelectors: popupSelectors.length,
          },
          null,
          0,
        )}`,
      );

      const priorRaw = shopDomain ? await readPriorDeferTokens(shopDomain) : [];
      const isEmittable = (x: string) =>
        !foldRequiredScripts.has(x) &&
        !coverageRan.has(x) &&
        !coverageUnknown.has(x) &&
        !selfScripts.has(x) &&
        !neverDefer.has(x);
      const priorFiltered = priorRaw.filter(isEmittable);
      const mergedDefer = mergeSlugVariants([...emittedRaw, ...priorFiltered]).sort();

      const labVitalsByPath: Record<string, import("./audit-report-types").LabVitalsEntry> = {};
      const resourcesByPath: Record<
        string,
        NonNullable<MeasuredPage["resourceRows"]>
      > = {};
      measured.forEach((m, i) => {
        const path = safePathname(urls[i]);
        if (m.labVitals) labVitalsByPath[path] = m.labVitals;
        if (m.resourceRows?.length) resourcesByPath[path] = m.resourceRows;
      });

      const { applyExtraPageDeferRules } = await import("./audit-template-extra");
      const { tokensSeenByPathFromResources } = await import(
        "./audit-resource-tokens"
      );
      const seenByPath = tokensSeenByPathFromResources(resourcesByPath);
      const deferByPageMerged = Object.fromEntries(
        Object.entries(deferArrayByPage).map(([k, v]) => [
          k,
          mergeSlugVariants(v).sort(),
        ]),
      );
      let deferBuckets = buildTemplateDeferBuckets(deferByPageMerged, pageRoles);
      deferBuckets = applyExtraPageDeferRules(
        deferBuckets,
        deferByPageMerged,
        pageRoles,
        seenByPath,
      );
      const templateBuckets = {
        defer: deferBuckets,
        hide: buildTemplateListBuckets(hideSelectorsByPage, pageRoles),
      };

      const draftReport: HiddenAuditResult = {
        deferArray: mergedDefer,
        deferArrayByPage: Object.fromEntries(
          Object.entries(deferArrayByPage).map(([k, v]) => [k, mergeSlugVariants(v).sort()]),
        ),
        deferArrayUnmerged: emittedRaw.sort(),
        deferArrayBase: [...baseScripts].sort(),
        deferArrayAddByPage,
        hideSelectors: emittedHideSelectors,
        hideSelectorsByPage: Object.fromEntries(
          Object.entries(hideSelectorsByPage).map(([path, list]) => [
            path,
            [...new Set([...list, ...popupSelectors])].sort(),
          ]),
        ),
        popupSelectors,
        popupSelectorsByPage,
        pagePatterns,
        pageRoles,
        templateBuckets,
        neverDefer: [...neverDefer].sort(),
        selfExcluded: [...selfScripts].sort(),
        noiseDropped: [...noise].sort(),
        foldReasons,
        funnel,
        foldAssertion,
        pagesAudited: urls.map((u) => safePathname(u)),
        completedAt: new Date().toISOString(),
        labVitalsByPath,
      };

      draftReport.scriptInventory = buildScriptInventory(draftReport, resourcesByPath);

      const homeUrl = urls[0];
      const homePath = safePathname(homeUrl);
      const gateImpact = await measureGateImpactOnHome(
        browser,
        homeUrl,
        password,
        mergedDefer,
        emittedHideSelectors,
        labVitalsByPath[homePath],
      );
      if (gateImpact) {
        draftReport.gateImpact = gateImpact;
      } else {
        draftReport.warnings = [
          ...(draftReport.warnings ?? []),
          "GATE_IMPACT_SKIPPED",
        ];
      }

      draftReport.auditRunMeta = {
        wallTimeMs: Date.now() - auditStarted,
        passesRun,
        passesPlanned: AUDIT_REPEAT_PASSES,
      };

      return draftReport;
    } finally {
      await Promise.all(measured.map((m) => m.context.close().catch(() => {})));
    }
  });
}
