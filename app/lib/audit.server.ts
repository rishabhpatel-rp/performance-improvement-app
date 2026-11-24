import {
  classifyCandidate,
  mergeSlugVariants,
  normalizeTokenForCrossRun,
  pageMatchPatterns,
  shouldProtectUnknownCoverageScript,
  tokenEligibleForGlobalDefer,
  urlToCandidates,
} from "./audit-candidates";
import { getEnv } from "./env.server.ts";
import { classifyDeferTier, computeDeferConfidence } from "./audit-confidence.ts";
import { buildScriptInventoryFromClassified } from "./audit-classified-inventory.ts";
import { filterSelectorsWithInteractiveChildren } from "./audit-hide-safety-browser.server.ts";
import { applyHideSelectorHygiene } from "./audit-hide-safety.server";
import { buildScriptInventory } from "./audit-inventory.server.ts";
import { AUDIT_PASS_GAP_MS } from "./audit-timing.ts";
import { logger } from "./logger.ts";
import { AuditRunCancelledError } from "./audit-cancel.ts";
import { withBrowser } from "./audit-browser.ts";
import {
  AUDIT_REPEAT_PASSES,
  AuditBlockedError,
  AuditProgress,
  DiscoveredPages,
  HiddenAuditResult,
  MeasuredPage,
  PageFunnel,
  assertAuditRunActive,
  safePathname,
} from "./audit-core.ts";
import { measurePage } from "./audit-measure.ts";
import {
  collectTokensFromPass,
  setDiff,
  setsAreEqual,
  summarizeGateFunnel,
  summarizeSafetyNet,
} from "./audit-obs.ts";
import { logAuditEvent } from "./audit-logging.server.ts";
import { buildScriptListFingerprint } from "./audit-fingerprint.ts";
import {
  readPriorDeferTokens,
  selectorsOverlapFoldOnPage,
  selectorsVisibleOnPage,
} from "./audit-postpass.ts";
import {
  collapseToParentSelectors,
  screenshotFoldRegression,
  verifyFoldSurvives,
} from "./audit-settle.ts";
import type { DeferTier, ScriptLoadingHint } from "./audit-candidates";
import { buildTemplateDeferBuckets, buildTemplateListBuckets } from "./audit-template-buckets.ts";
import { buildPageRolesFromDiscovered } from "./page-audit-roles.ts";
import { storefrontImpactForDeferTier } from "./audit-tier-copy.ts";
export { pickPagesFromDiscovery, findPagesInHtml } from "./audit-discovery.ts";
export {
  AuditBlockedError,
  AuditRunCancelledError,
  AuditRunTimeoutError,
  appendPreviewParams,
  describePages,
} from "./audit-core.ts";
export type {
  AuditBlockCode,
  AuditPageInfo,
  AuditPhase,
  AuditProgress,
  DiscoveredPages,
  FoldAssertion,
  HiddenAuditResult,
  PageFunnel,
} from "./audit-core.ts";
export {
  isPasswordPage,
  isPasswordPageHtml,
  returnToRequestedUrl,
  unlockPasswordPage,
  withBrowser,
} from "./audit-browser.ts";
export { discoverPages } from "./audit-discovery-runtime.ts";

type TokenTiming = {
  homeRequestOrder?: number;
  homeStartMs?: number;
  bytes?: number;
  tbtContributionMs?: number;
};

function buildHomeResourceTimingIndex(
  homeMeasured: MeasuredPage,
  homeUrl: string,
): Map<string, TokenTiming> {
  const map = new Map<string, TokenTiming>();
  for (const row of homeMeasured.resourceRows ?? []) {
    const buckets = urlToCandidates(row.url, homeUrl);
    for (const t of [...buckets.kept, ...buckets.neverDefer]) {
      const order = row.requestOrder ?? 999;
      const prev = map.get(t);
      if (!prev || order < (prev.homeRequestOrder ?? 999)) {
        map.set(t, {
          homeRequestOrder: row.requestOrder,
          homeStartMs: row.startTime,
          bytes: row.transferSize ?? row.encodedBodySize,
          tbtContributionMs: Math.max(prev?.tbtContributionMs ?? 0, row.tbtContributionMs ?? 0),
        });
      } else if (row.tbtContributionMs != null && prev) {
        prev.tbtContributionMs = Math.max(prev.tbtContributionMs ?? 0, row.tbtContributionMs);
      }
    }
  }
  return map;
}

function coverageVerdictForToken(
  token: string,
  coverageRan: Set<string>,
  coverageUnknown: Set<string>,
): "ran" | "unknown" | "idle" {
  if (coverageRan.has(token)) return "ran";
  if (coverageUnknown.has(token)) return "unknown";
  return "idle";
}

export async function runHiddenAudit({
  pages,
  password,
  shopDomain,
  onProgress,
  signal,
  runDeadlineAt,
  shouldStop,
}: {
  pages: DiscoveredPages;
  /** Used only to pool the previous run's tokens (see readPriorDeferTokens). */
  shopDomain?: string;
  // Store owner's storefront password (Step 1). `pages` URLs already carry
  // the `?password=` bypass query param when set — this is only used as a
  // fallback to submit Shopify's password form if the query param alone
  // doesn't let the store through.
  password?: string;
  onProgress?: (progress: AuditProgress) => void | Promise<void>;
  signal?: AbortSignal;
  runDeadlineAt?: number;
  shouldStop?: () => boolean | Promise<boolean>;
}): Promise<HiddenAuditResult> {
  // Extras are appended so they are genuinely MEASURED, not merely stored. A
  // saved-but-unaudited URL would be a lie in the UI. They keep the home/PLP/PDP
  // order so the three canonical pages stay first in the report.
  const urls = [pages.home, pages.plp, pages.pdp, ...(pages.extras ?? [])].filter(
    (u): u is string => Boolean(u),
  );

  let done = 0;
  await onProgress?.({ done, total: urls.length });

  return withBrowser(async (browser) => {
    // Every pass is kept, so a script whose token varies between passes produces
    // several variants for `mergeSlugVariants` to unify.
    const measuredAll: MeasuredPage[] = [];
    // Deduplicated by URL (first pass wins). The funnel and the per-page selector
    // logic want one row per page, not one per pass.
    const measured: MeasuredPage[] = [];
    const seenPaths = new Set<string>();
    const auditStartedAt = Date.now();
    let passesRun = 0;
    let earlyPassTerminated = false;
    let plannedPasses = AUDIT_REPEAT_PASSES;
    try {
      // allSettled: one page failing to open must not abandon the others'
      // contexts (they are all closed in `finally`).
      for (let pass = 0; pass < AUDIT_REPEAT_PASSES; pass++) {
        assertAuditRunActive(signal, runDeadlineAt);
        if (shouldStop && (await shouldStop())) throw new AuditRunCancelledError();
        const pageParallel = Math.max(1, getEnv().AUDIT_MAX_PARALLEL_PAGES);
        const measureOne = async (url: string) => {
          // LongTask / TBT data is only meaningful on the home page (urls[0]).
          // Collecting it on PLP/PDP wastes 120 ms per page with zero accuracy impact
          // because tbtContributionMs is only read from the home page result.
          const isHomePage = url === urls[0];
          const m = await measurePage(
            browser,
            url,
            password,
            pass > 0,
            () => {
              if (signal?.aborted || (runDeadlineAt != null && Date.now() > runDeadlineAt))
                return true;
              return shouldStop?.() === true;
            },
            isHomePage, // collectLongTask
            isHomePage, // scroll adapt
          );
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
          } else if (pass > 0) {
            await m.context.close().catch(() => {});
          }
          done++;
          try {
            await onProgress?.({
              done,
              total: urls.length * plannedPasses,
              path,
            });
          } catch {
            // progress is best-effort
          }
        };
        const settled: PromiseSettledResult<void>[] = [];
        for (let bi = 0; bi < urls.length; bi += pageParallel) {
          const batch = urls.slice(bi, bi + pageParallel);
          const batchResults = await Promise.allSettled(batch.map((url) => measureOne(url)));
          settled.push(...batchResults);
        }
        passesRun = pass + 1;
        if (shouldStop && (await shouldStop())) throw new AuditRunCancelledError();
        const passFailed = measuredAll.length < (pass + 1) * urls.length;
        if (passFailed && pass === 0) {
          const failure = settled.find((r) => r.status === "rejected");
          throw failure && failure.status === "rejected"
            ? failure.reason
            : new Error("No pages could be audited.");
        }
        // Sprint 2 — early pass termination: if pass 1 and pass 2 token sets
        // match, skip pass 3 (stable CDN URLs, no per-request nonces).
        if (pass === 1 && AUDIT_REPEAT_PASSES >= 3 && getEnv().AUDIT_EARLY_PASS_TERMINATION) {
          const pass1Tokens = collectTokensFromPass(measuredAll, urls.length, 0);
          const pass2Tokens = collectTokensFromPass(measuredAll, urls.length, 1);
          if (pass1Tokens.size > 0 && setsAreEqual(pass1Tokens, pass2Tokens)) {
            earlyPassTerminated = true;
            plannedPasses = 2;
            try {
              await onProgress?.({
                done,
                total: urls.length * plannedPasses,
              });
            } catch {
              // progress is best-effort
            }
            logger.info(
              `[Audit] Token set stable after pass 2 for ${shopDomain ?? "shop"} — skipping pass 3`,
            );
            logAuditEvent("audit_obs", {
              shop: shopDomain ?? null,
              eventDetail: "early_pass_termination",
              pass1TokenCount: pass1Tokens.size,
              pass2TokenCount: pass2Tokens.size,
              tokenSetStable: true,
              passesRun: 2,
              passesPlanned: plannedPasses,
            });
            break;
          }
        }
        if (pass < AUDIT_REPEAT_PASSES - 1) {
          await new Promise((r) => setTimeout(r, AUDIT_PASS_GAP_MS));
        }
      }
      if (measured.some((m) => m.blocked)) {
        throw new AuditBlockedError(password ? "PASSWORD_INCORRECT" : "PASSWORD_REQUIRED");
      }
      if (measured.length === 0) {
        // A pass that measured nothing already threw above on pass 0; this
        // only guards the case where every later pass came back empty.
        throw new Error("No pages could be audited.");
      }

      const homeUrl = urls[0];
      const resourceTimingIndex = buildHomeResourceTimingIndex(measured[0], homeUrl);
      const totalPages = measured.length;

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
      // Slug harvest passes only contribute to `mergeSlugVariants` via measuredAll
      // funnel rows. Defer/hide/coverage unions use the first full measure per URL.
      for (const { acc } of measured) {
        acc.p.forEach((x) => pSet.add(x));
        acc.vis.forEach((x) => visSet.add(x));
        acc.off.forEach((x) => offSet.add(x));
        acc.foldScripts.forEach((x) => foldRequiredScripts.add(x));
        Object.entries(acc.foldReasons).forEach(([k, v]) => {
          if (!foldReasons[k]) foldReasons[k] = v;
        });
        acc.neverDefer.forEach((x) => neverDefer.add(x));
        acc.noise.forEach((x) => noise.add(x));
        acc.selfScripts.forEach((x) => selfScripts.add(x));
        acc.coverageRan.forEach((x) => coverageRan.add(x));
        acc.coverageUnknown.forEach((x) => coverageUnknown.add(x));
      }
      for (const { acc } of measuredAll) {
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

      const tokenPages = new Map<string, Set<string>>();
      measured.forEach((m, i) => {
        const path = safePathname(urls[i]);
        for (const t of m.acc.p) {
          let set = tokenPages.get(t);
          if (!set) {
            set = new Set();
            tokenPages.set(t, set);
          }
          set.add(path);
        }
      });
      const tokenOkForGlobalDefer = (token: string) =>
        tokenEligibleForGlobalDefer(tokenPages.get(token) ?? []);

      const homeIdx = measured.findIndex((_, i) => safePathname(urls[i]) === "/");
      const homeNeverDefer = new Set(homeIdx >= 0 ? measured[homeIdx].acc.neverDefer : []);

      // The script's own cross-page check (an off-screen selector is not
      // hidden if it is a visible section somewhere) needs every page's DOM;
      // pages were audited in isolation, so redo it here across all of them.
      const offList = [...offSet];
      const visibleHits = await Promise.all(
        measured.map(({ page }) => selectorsVisibleOnPage(page, offList)),
      );
      visibleHits.forEach((hits) => hits.forEach((x) => visSet.add(x)));

      // Same cross-page re-check, but for the 1100px fold band instead of
      // plain viewport visibility — see `selectorsOverlapFoldOnPage`.
      const foldHits = await Promise.all(
        measured.map(({ page }) => selectorsOverlapFoldOnPage(page, offList)),
      );
      foldHits.forEach((hits) => hits.forEach((x) => visSet.add(x)));

      // A selector is only ever hidden if nothing it matches sits in the first
      // 1100px on ANY audited page — including an element that only appears
      // later or after interaction. This is checked against every page's live
      // DOM, so a class shared between the fold and the rest of the page is
      // never hidden at all (safe, though it yields nothing).
      const crossPageFoldOnly = await Promise.all(
        measured.map(({ page }) => selectorsOverlapFoldOnPage(page, offList)),
      );
      const foldProtectedSelectors = new Set<string>();
      crossPageFoldOnly.forEach((hits) => hits.forEach((x) => foldProtectedSelectors.add(x)));

      const hideCandidates = offList.filter(
        (x) => !visSet.has(x) && !foldProtectedSelectors.has(x),
      );

      // Collapse to maximal below-fold parents. Hiding 127 per-element
      // selectors is both a large inline stylesheet and fragile; collapsing to
      // the handful of top-most fully-below-fold subtrees is ~93% smaller on a
      // measured page and structurally safer. Every candidate is still checked
      // against the cross-page fold veto above, so collapsing cannot widen what
      // gets hidden beyond what was already proven safe.
      const collapsedSelectors = await Promise.all(
        measured.map(({ page }) => collapseToParentSelectors(page, hideCandidates)),
      );
      const selectorSet = new Set<string>();
      for (const list of collapsedSelectors) list.forEach((s) => selectorSet.add(s));
      // A collapsed parent may reintroduce a selector the veto rejected; drop it.
      for (const s of selectorSet) {
        if (foldProtectedSelectors.has(s) || visSet.has(s)) selectorSet.delete(s);
      }
      let hideSelectors = [...selectorSet].sort();
      const hideHygiene = applyHideSelectorHygiene(hideSelectors);
      hideSelectors = hideHygiene.hideSelectors;
      if (hideHygiene.warnings.length) {
        logger.warn(
          `[audit] Dropped ${hideHygiene.warnings.length} unsafe hide selector(s):`,
          hideHygiene.warnings.slice(0, 8).join(", "),
        );
      }

      for (const m of measured) {
        const filtered = await filterSelectorsWithInteractiveChildren(m.page, hideSelectors);
        if (filtered.rejected.length) {
          logger.warn(
            `[audit] Rejected ${filtered.rejected.length} hide selector(s) with interactive children`,
          );
        }
        hideSelectors = hideSelectors.filter((s) => filtered.safe.includes(s));
      }

      const postHygieneFoldVeto = await Promise.all(
        measured.map(({ page }) => selectorsOverlapFoldOnPage(page, hideSelectors)),
      );
      postHygieneFoldVeto.forEach((hits) => hits.forEach((x) => foldProtectedSelectors.add(x)));
      hideSelectors = hideSelectors
        .filter((x) => !foldProtectedSelectors.has(x) && !visSet.has(x))
        .sort();

      // Per-page hide lists. The consumer resolves its page at runtime from
      // location.pathname, so each audited page contributes its own collapsed
      // selectors plus the match patterns that generalise them to sibling pages
      // (a store serves thousands of PDPs but the audit only ever sees three
      // URLs). `hideSelectors` above stays the union so the existing consumer
      // path is unchanged.
      const hideSelectorsByPage: Record<string, string[]> = {};
      const pagePatterns: Record<string, string[]> = {};
      measured.forEach((m, i) => {
        const path = safePathname(urls[i]);
        const local = new Set<string>();
        for (const list of collapsedSelectors[i]) {
          if (foldProtectedSelectors.has(list) || visSet.has(list)) continue;
          local.add(list);
        }
        hideSelectorsByPage[path] = [...local]
          .filter((x) => !foldProtectedSelectors.has(x) && !visSet.has(x))
          .sort();
        pagePatterns[path] = pageMatchPatterns(path);
      });

      const isEmittableGlobal = (x: string) => {
        if (!tokenOkForGlobalDefer(x)) return false;
        if (foldRequiredScripts.has(x)) return false;
        if (coverageRan.has(x)) return false;
        if (selfScripts.has(x)) return false;
        if (homeNeverDefer.has(x)) return false;
        if (noise.has(x)) return false;
        if (coverageUnknown.has(x)) {
          return !shouldProtectUnknownCoverageScript(resourceTimingIndex.get(x) ?? {});
        }
        return true;
      };

      const emittedRaw = [...pSet].filter(isEmittableGlobal);

      // Per-page breakdown. `deferArray` below stays the union so the existing
      // consumer path (StoreConfig -> rebuildPerformanceScript -> obfuscate ->
      // proxy) is completely unchanged; the per-page view and the slug view are
      // additive and ride inside the same result object.
      const deferArrayByPage: Record<string, string[]> = {};
      measured.forEach((m, i) => {
        const acc = m.acc;
        const localNever = new Set(acc.neverDefer);
        const isPageEmittable = (x: string) => {
          if (!tokenOkForGlobalDefer(x)) return false;
          if (acc.foldScripts.includes(x)) return false;
          if (acc.coverageRan.includes(x)) return false;
          if (acc.selfScripts.includes(x)) return false;
          if (localNever.has(x)) return false;
          if (acc.noise.includes(x)) return false;
          if (acc.coverageUnknown.includes(x)) {
            return !shouldProtectUnknownCoverageScript(resourceTimingIndex.get(x) ?? {});
          }
          return true;
        };
        deferArrayByPage[safePathname(urls[i])] = acc.p.filter(isPageEmittable).sort();
      });

      // Fold-survival assertion. The whole premise is that the first 1100px
      // still looks right with the gate active, and nothing used to check it —
      // which is how an empty `deferArray` shipped unnoticed. This re-applies
      // the emitted hide CSS to each page and asks the browser whether any
      // fold-overlapping element disappeared.
      const foldAssertion = await verifyFoldSurvives(measured, hideSelectors);
      if (!foldAssertion.ok) {
        hideSelectors = [];
        for (const path of Object.keys(hideSelectorsByPage)) {
          hideSelectorsByPage[path] = [];
        }
      } else if (hideSelectors.length > 0) {
        const homeIdx = urls.findIndex((u) => safePathname(u) === "/");
        const shotPage = homeIdx >= 0 ? measured[homeIdx]?.page : measured[0]?.page;
        if (shotPage) {
          const shot = await screenshotFoldRegression(shotPage, hideSelectors);
          if (shot.regressed) {
            logger.warn(
              `[audit] Screenshot fold regression (${(shot.changedPixelFraction * 100).toFixed(1)}% pixels) — clearing hide selectors`,
            );
            hideSelectors = [];
            for (const path of Object.keys(hideSelectorsByPage)) {
              hideSelectorsByPage[path] = [];
            }
          }
        }
      }

      const homeMeasured = measured.find((_, i) => safePathname(urls[i]) === "/") ?? measured[0];
      const loadingHintByToken: Record<string, ScriptLoadingHint> = {
        ...(homeMeasured?.loadHintsByToken ?? {}),
      };
      const homeDomMutation = homeMeasured?.acc.settle.domMutationCount ?? 0;

      // Base + delta. The storefront bundle ships the intersection once and each
      // page only its extras, which keeps a render-blocking script small: full
      // per-page lists measured +65% bundle size for the same behaviour.
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

      // The funnel is logged here rather than in audit-runner.server.ts so the
      // change stays inside the audit module. A `defer=[]` from "everything is
      // fold-protected" must be distinguishable from `defer=[]` caused by a
      // cleared array — that ambiguity is what hid the coverage bug.
      logger.info(
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
          },
          null,
          0,
        )}`,
      );

      // Sprint 1 observability (§8.1–§8.3) — structured event for soak dashboards.
      const safetyNet = summarizeSafetyNet(funnel);
      const pass1Tokens = collectTokensFromPass(measuredAll, urls.length, 0);
      const pass2Tokens = collectTokensFromPass(measuredAll, urls.length, 1);
      const tokenSetStable =
        AUDIT_REPEAT_PASSES >= 2 && pass1Tokens.size > 0
          ? setsAreEqual(pass1Tokens, pass2Tokens)
          : null;
      const gateTokens = new Set<string>([...pSet, ...neverDefer, ...noise]);
      const gateFunnel = summarizeGateFunnel(gateTokens);
      logAuditEvent("audit_obs", {
        shop: shopDomain ?? null,
        pages: urls.length,
        passes: passesRun,
        passesPlanned: AUDIT_REPEAT_PASSES,
        earlyPassTerminated,
        safetyNetHits: safetyNet.hits,
        safetyNetTotal: safetyNet.total,
        safetyNetRate: Number(safetyNet.rate.toFixed(4)),
        pass1TokenCount: pass1Tokens.size,
        pass2TokenCount: pass2Tokens.size,
        tokenSetStable,
        tokensOnlyInPass1: setDiff(pass1Tokens, pass2Tokens).slice(0, 20),
        tokensOnlyInPass2: setDiff(pass2Tokens, pass1Tokens).slice(0, 20),
        gateByName: gateFunnel.byGate,
        wouldGate4C: gateFunnel.wouldGate4C,
        wouldGate4E: gateFunnel.wouldGate4E,
        kept: pSet.size,
        neverDefer: neverDefer.size,
        noise: noise.size,
      });

      // Build hashes change between theme versions, not between the pages of a
      // single run, so this is normally a no-op here. It exists so a report
      // emitted as `app.9pOKhaB_.js` stops silently matching after the merchant
      // redeploys: divergent variants of one script are unified to their
      // longest common prefix (`store-BTEJUR`/`store-BTEJKB` -> `store-BTE`).
      // Three sources feed the merge:
      //   1. this run's tokens across AUDIT_REPEAT_PASSES (per-request and
      //      short time-windowed variation),
      //   2. the PREVIOUS run's tokens (deploy-time hash changes, which no
      //      in-run sampling can see because every pass hits the same build),
      //   3. nothing else — identical repeats stay verbatim.
      //
      // Prior tokens go through the SAME filter as this run's. Without that, a
      // script that is fold-protected or coverage-verified NOW could be
      // resurrected from the previous report and gated again, which is the
      // unsafe direction.
      const priorRaw = shopDomain ? await readPriorDeferTokens(shopDomain) : [];
      const currentTokens = [...pSet];
      const byNorm = new Map(currentTokens.map((t) => [normalizeTokenForCrossRun(t), t] as const));
      const priorAligned = priorRaw.map((p) => byNorm.get(normalizeTokenForCrossRun(p)) ?? p);
      const priorFiltered = priorAligned.filter(isEmittableGlobal);
      const mergedSlugDefer = mergeSlugVariants([...emittedRaw, ...priorFiltered]).sort();

      const delayEveryArray: string[] = [];
      const delayFirstArray: string[] = [];
      const interactionDefer: string[] = [];
      const tierByToken = new Map<string, DeferTier>();
      const confidenceByToken = new Map<string, number>();
      for (const token of mergedSlugDefer) {
        if (classifyCandidate(token) === "never-defer") continue;
        const timing = resourceTimingIndex.get(token) ?? {};
        const verdict = coverageVerdictForToken(token, coverageRan, coverageUnknown);
        const loadingHint = loadingHintByToken[token] ?? "unknown";
        const confidence = computeDeferConfidence({
          coverageVerdict: verdict,
          loadingHint,
          homeRequestOrder: timing.homeRequestOrder,
          homeStartMs: timing.homeStartMs,
          bytes: timing.bytes,
          tbtContributionMs: timing.tbtContributionMs,
          domMutationCount:
            verdict === "unknown" && homeDomMutation > 0 ? homeDomMutation : undefined,
          appearsOnPages: deferArrayByPage
            ? Object.values(deferArrayByPage).filter((list) => list.includes(token)).length
            : 1,
          totalPages,
        });
        const tier = classifyDeferTier({
          confidence,
          coverageVerdict: verdict,
          homeRequestOrder: timing.homeRequestOrder,
          homeStartMs: timing.homeStartMs,
          loadingHint,
        });
        tierByToken.set(token, tier);
        confidenceByToken.set(token, confidence);
        if (tier === "delay-every") delayEveryArray.push(token);
        else if (tier === "delay-first") delayFirstArray.push(token);
        else if (tier === "interaction") interactionDefer.push(token);
      }
      const mergedDefer = interactionDefer.sort();

      const pagesAudited = urls.map((u) => {
        try {
          return new URL(u).pathname || "/";
        } catch {
          return u;
        }
      });
      const resourcesByPath: Record<string, NonNullable<MeasuredPage["resourceRows"]>> = {};
      for (const m of measured) {
        for (const row of m.resourceRows || []) {
          const path = row.pathname || "/";
          if (!resourcesByPath[path]) resourcesByPath[path] = [];
          resourcesByPath[path].push(row);
        }
      }
      const listInventory = buildScriptInventoryFromClassified({
        deferArray: mergedDefer,
        neverDefer: [...neverDefer],
        noiseDropped: [...noise],
        selfExcluded: [...selfScripts],
        foldReasons,
        deferArrayByPage,
      });
      const resourceInventory = buildScriptInventory(
        {
          deferArray: mergedDefer,
          neverDefer: [...neverDefer],
          noiseDropped: [...noise],
          selfExcluded: [...selfScripts],
          foldReasons,
          pagesAudited,
        },
        resourcesByPath,
      );
      const scriptInventory = resourceInventory.byToken.length ? resourceInventory : listInventory;
      if (resourceInventory.byToken.length) {
        const seen = new Set(scriptInventory.byToken.map((entry) => entry.token));
        for (const extra of listInventory.byToken) {
          if (!seen.has(extra.token)) scriptInventory.byToken.push(extra);
        }
      }
      for (const entry of scriptInventory.byToken) {
        const hint = loadingHintByToken[entry.token];
        if (hint) entry.loadingHint = hint;
        const tier = tierByToken.get(entry.token);
        if (tier) {
          entry.deferTier = tier;
          entry.deferConfidence = confidenceByToken.get(entry.token);
          entry.storefrontImpact = storefrontImpactForDeferTier(tier);
        }
      }

      const pageRoles = buildPageRolesFromDiscovered(pages, pagesAudited);
      const deferByPathForBuckets: Record<string, string[]> = {};
      for (const [path, list] of Object.entries(deferArrayByPage)) {
        deferByPathForBuckets[path] = mergeSlugVariants(list).sort();
      }
      const templateBuckets = {
        defer: buildTemplateDeferBuckets(deferByPathForBuckets, pageRoles),
        hide: buildTemplateListBuckets(hideSelectorsByPage, pageRoles),
      };

      const scriptListFingerprint = buildScriptListFingerprint([
        ...pSet,
        ...neverDefer,
        ...noise,
        ...selfScripts,
      ]);

      return {
        deferArray: mergedDefer,
        delayEveryArray: [...new Set(delayEveryArray)].sort(),
        delayFirstArray: [...new Set(delayFirstArray)].sort(),
        deferArrayByPage: Object.fromEntries(
          Object.entries(deferArrayByPage).map(([k, v]) => [k, mergeSlugVariants(v).sort()]),
        ),
        /** The un-merged tokens, kept so the funnel can be reconciled. */
        deferArrayUnmerged: emittedRaw.sort(),
        /** Scripts every audited page loads — shipped once in the bundle. */
        deferArrayBase: [...baseScripts].sort(),
        /** Per-page extras on top of `deferArrayBase`. */
        deferArrayAddByPage,
        hideSelectors,
        hideSelectorsByPage,
        pagePatterns,
        neverDefer: [...neverDefer].sort(),
        selfExcluded: [...selfScripts].sort(),
        noiseDropped: [...noise].sort(),
        foldReasons,
        funnel,
        foldAssertion,
        // Paths only: the audited URLs carry `?password=` / `preview_theme_id=`,
        // and this list is persisted in AuditLog.
        pagesAudited,
        completedAt: new Date().toISOString(),
        scriptInventory,
        pageRoles,
        templateBuckets,
        auditRunMeta: {
          wallTimeMs: Date.now() - auditStartedAt,
          passesRun,
          passesPlanned: plannedPasses,
          earlyPassTerminated,
          scriptListFingerprint,
        },
      };
    } finally {
      const contexts = new Set(measuredAll.map((m) => m.context));
      for (const m of measured) contexts.add(m.context);
      await Promise.all([...contexts].map((c) => c.close().catch(() => {})));
    }
  });
}
