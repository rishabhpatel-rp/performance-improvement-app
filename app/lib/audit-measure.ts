import {
  coverageVerdict,
  isNeverDeferPathname,
  type ScriptLoadingHint,
  urlToCandidates,
} from "./audit-candidates";
import { buildGatedSinglePageAuditScript } from "./audit-script";
import { MEASURE_TIMEOUT_MS, PAGE_LOAD_TIMEOUT_MS } from "./audit-timing.ts";
import { logger } from "./logger.ts";
import { type Browser } from "playwright";
import { isPasswordPage, returnToRequestedUrl, unlockPasswordPage } from "./audit-browser.ts";
import {
  MeasuredPage,
  OFF_KEY,
  P_KEY,
  STORE_KEY,
  ScriptCoverageEntry,
  VIS_KEY,
  emptyAccumulators,
  isRealScriptUrl,
  safePathname,
} from "./audit-core.ts";
import { captureInitialFold, simulateInteractions, waitForScriptsSettled } from "./audit-settle.ts";

export async function measurePage(
  browser: Browser,
  url: string,
  password?: string,
  /**
   * Harvest only: collect the script NAMES this page loads and nothing else.
   *
   * Repeat passes after the first exist solely to observe token variation, and
   * the names come from the in-page `P_KEY` accumulator. Coverage, the fold
   * snapshot and the interaction pass all cost time and none of them affect a
   * name. Skipping them is therefore free precision-wise: the fold/coverage
   * filters are applied to the pooled token set afterwards, so a harvested name
   * is still filtered exactly as before.
   */
  harvestOnly = false,
  isStopped?: () => boolean,
): Promise<MeasuredPage> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();

    // Authoritative script inventory. `performance.getEntriesByType('resource')`
    // is capped at 250 entries by Chromium, and on a measured store 32 of 204
    // scripts were absent from resource timing while still being visible here
    // (Shopify Pay's arrive-server chunks, preview-bar). `script[src]` in the
    // DOM is also far smaller (~38) because most scripts arrive via preload /
    // modulepreload / dynamic import. This listener sees every request
    // regardless of any in-page buffer, so it is the source of truth and the
    // two in-page sources become a cross-check rather than the only source.
    const requestScripts: string[] = [];
    const seenRequestUrls = new Set<string>();
    const responseBytes = new Map<string, number>();
    const onRequest = (req: import("playwright").Request) => {
      const u = req.url();
      if (/\.js(\?|$)/i.test(u) && !seenRequestUrls.has(u)) {
        seenRequestUrls.add(u);
        requestScripts.push(u);
      }
    };
    const onResponse = (res: import("playwright").Response) => {
      const u = res.url();
      if (!/\.js(\?|$)/i.test(u)) return;
      const header = Number(res.headers()["content-length"]);
      if (Number.isFinite(header) && header > 0) {
        responseBytes.set(u, Math.max(responseBytes.get(u) || 0, header));
      }
    };
    page.on("request", onRequest);
    page.on("response", onResponse);

    // Precise coverage must be armed before the first script is parsed.
    //
    // Playwright's `page.coverage.startJSCoverage()` is NOT sufficient here: in
    // this configuration it returns block coverage only (every entry is
    // `isBlockCoverage: true` with an empty `functionName`), so `coverageVerdict`
    // can never report `ran` and the gate has been unable to tell a script that
    // executed from one that did not. CDP's `Profiler.startPreciseCoverage`
    // with `detailed: true` returns real function-level data, which is what
    // makes the `ran` / `unknown` / `idle` split meaningful. Falls back to the
    // Playwright API if the CDP call is unavailable.
    let cdpCoverage: import("playwright").CDPSession | null = null;
    let usingPreciseCoverage = false;
    // Coverage is skipped on a harvest pass: it costs a CDP session plus a
    // stopJSCoverage round trip, and it only decides whether a token is
    // PROTECTED -- it never changes the token's name, which is the only thing
    // the repeat passes exist to observe.
    if (!harvestOnly) {
      try {
        cdpCoverage = await page.context().newCDPSession(page);
        await cdpCoverage.send("Profiler.enable");
        await cdpCoverage.send("Profiler.startPreciseCoverage", {
          detailed: true,
          allowTriggeredUpdates: false,
        });
        usingPreciseCoverage = true;
      } catch {
        await page.coverage.startJSCoverage().catch(() => {});
      }
    }
    if (!harvestOnly) {
      await page.addInitScript({
        content: `
          window.__ppMutations = 0;
          (function armMut() {
            var root = document.documentElement;
            if (!root || typeof MutationObserver === 'undefined') return;
            new MutationObserver(function (muts) {
              window.__ppMutations += muts.length;
            }).observe(root, { childList: true, subtree: true, attributes: false });
          })();
        `,
      });
    }
    await page.addInitScript({ content: buildGatedSinglePageAuditScript(url) });

    try {
      await page.goto(url, { waitUntil: "load", timeout: PAGE_LOAD_TIMEOUT_MS });

      // Some password-protected stores don't honor the `?password=` query
      // param on every request path, so detect the password page and submit
      // the password form directly, then return to the page we asked for.
      if (password && (await unlockPasswordPage(page, password))) {
        await returnToRequestedUrl(page, url, PAGE_LOAD_TIMEOUT_MS);
      }
    } catch (err) {
      logger.info(
        `[audit] Page load failed (${new URL(url).pathname}):`,
        err instanceof Error ? err.message : err,
      );
      // A page that never rendered (DNS/connection error page) never ran the
      // audit script; skip the settle/measure waits instead of timing out.
      const scriptRan = await page
        .evaluate(
          () =>
            typeof (window as unknown as { __ppOpenGate?: unknown }).__ppOpenGate === "function",
        )
        .catch(() => false);
      if (!scriptRan) {
        return {
          context,
          page,
          acc: emptyAccumulators(),
        };
      }
    }

    // Still on the password page (no password saved, or the saved one did not
    // unlock it): there is nothing to measure — stop now instead of scanning it.
    if (await isPasswordPage(page)) {
      return {
        context,
        page,
        acc: emptyAccumulators(),
        blocked: true,
      };
    }

    // Let natural (non-interaction) init finish first: the `load` event only
    // means resources finished downloading, not that every above-fold widget
    // has run its init code yet (DOMContentLoaded callbacks, deferred
    // bundles, a short self-init delay are all common). Snapshotting coverage
    // before this would miss a slider that hasn't autoplayed/initialized yet
    // and wrongly treat its script as never-used.
    const preSettle = await waitForScriptsSettled(page, isStopped);

    // Capture the first FOLD_HEIGHT_PX ("initial viewport") before anything
    // is touched, then stop the pre-interaction JS coverage recording — both
    // describe the page exactly as it first renders (post-settle, pre-interaction).
    const fold = harvestOnly
      ? {
          selectors: [] as string[],
          scripts: [] as string[],
          reasons: {} as Record<string, string>,
        }
      : await captureInitialFold(page);

    // Read coverage now, while the page is still post-settle and
    // pre-interaction. Coverage has to be stopped here because anything the
    // interaction pass triggers would otherwise be attributed to the
    // pre-interaction state.
    let initialCoverage: ScriptCoverageEntry[] = [];
    if (usingPreciseCoverage && cdpCoverage) {
      const { result } = await cdpCoverage
        .send("Profiler.takePreciseCoverage")
        .catch(() => ({ result: [] as ScriptCoverageEntry[] }));
      initialCoverage = (result || []).filter((e) => isRealScriptUrl(e.url || ""));
      await cdpCoverage.send("Profiler.disable").catch(() => {});
    } else {
      initialCoverage = await page.coverage.stopJSCoverage().catch(() => []);
    }

    // Simulate a real browsing session (scroll, mouse movement, opening
    // menus/tabs/accordions/carousels) so lazy-loaded and interaction-gated
    // content actually renders before the page is measured.
    const interaction = harvestOnly
      ? { revealed: [] as string[], steps: 0, clicks: 0 }
      : await simulateInteractions(page);
    const revealedByInteraction = interaction.revealed;

    // Let the page settle again, then assert no *new* scripts arrived because
    // of the interaction. On the measured stores this delta is 0, so nothing
    // loads late — but it is now an assertion rather than an assumption, so a
    // store that does load on interaction cannot silently lose those scripts.
    await page.mouse.move(1, 1).catch(() => {});
    await page.mouse.move(3, 3).catch(() => {});
    const postSettle = await waitForScriptsSettled(page, isStopped);
    const postInteractionDelta = Math.max(0, postSettle.scriptCount - preSettle.scriptCount);
    if (postInteractionDelta > 0) {
      logger.info(
        `[audit] ${new URL(url).pathname}: +${postInteractionDelta} scripts loaded after interaction`,
      );
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});

    // Open the gate: the audit script measures now and stores its results.
    await page
      .evaluate(() => {
        const w = window as unknown as { __ppOpenGate?: () => void };
        w.__ppOpenGate?.();
      })
      .catch(() => {});

    await page
      .waitForFunction(
        (key) => {
          try {
            const s = JSON.parse(localStorage.getItem(key) || "{}");
            return typeof s.currentIndex === "number" && s.currentIndex >= 1;
          } catch {
            return false;
          }
        },
        STORE_KEY,
        { timeout: MEASURE_TIMEOUT_MS },
      )
      .catch(() => {
        logger.warn(`[audit] Measurement timed out for ${new URL(url).pathname}.`);
      });

    const read = await page
      .evaluate(
        ([P, VIS, OFF]) => {
          const load = (k: string) => {
            try {
              return JSON.parse(localStorage.getItem(k) || "[]");
            } catch {
              return [];
            }
          };
          return { p: load(P), vis: load(VIS), off: load(OFF) };
        },
        [P_KEY, VIS_KEY, OFF_KEY],
      )
      .catch(() => ({ p: [] as string[], vis: [] as string[], off: [] as string[] }));

    // ---- classify every script URL exactly once, from all three sources ----
    // The request log is authoritative; the in-page DOM and resource-timing
    // views are folded in so a script the request log missed (e.g. one served
    // from a service worker) is still not silently dropped.
    const allScriptUrls = new Set<string>(requestScripts);
    const requestTokens = new Set<string>();
    for (const u of allScriptUrls) {
      const b = urlToCandidates(u, url);
      b.kept.forEach((t) => requestTokens.add(t));
      b.neverDefer.forEach((t) => requestTokens.add(t));
    }

    const inPageSources = await page
      .evaluate(() => {
        const dom: string[] = [];
        const scriptHints: Array<{ src: string; loadHint: string }> = [];
        document.querySelectorAll("script[src]").forEach((s) => {
          const v = s.getAttribute("src");
          if (!v) return;
          dom.push(v);
          const el = s as HTMLScriptElement;
          const loadHint =
            s.getAttribute("type") === "module"
              ? "module"
              : s.hasAttribute("nomodule")
                ? "nomodule"
                : el.async
                  ? "async"
                  : el.defer
                    ? "defer"
                    : "blocking";
          scriptHints.push({ src: v, loadHint });
        });
        const rt = (performance.getEntriesByType("resource") as PerformanceResourceTiming[])
          .filter((e) => e.initiatorType === "script" || /\.js(\?|$)/i.test(e.name))
          .map((e) => e.name);
        return { dom, rt, scriptHints };
      })
      .catch(() => ({
        dom: [] as string[],
        rt: [] as string[],
        scriptHints: [] as Array<{ src: string; loadHint: string }>,
      }));

    const loadHintsByToken: Record<string, ScriptLoadingHint> = {};
    for (const row of inPageSources.scriptHints ?? []) {
      const abs = row.src.startsWith("//") ? `https:${row.src}` : row.src;
      const buckets = urlToCandidates(abs, url);
      const hint = row.loadHint as ScriptLoadingHint;
      for (const t of [...buckets.kept, ...buckets.neverDefer]) {
        if (!loadHintsByToken[t]) loadHintsByToken[t] = hint;
      }
    }

    const foldScripts: string[] = [];
    const foldReasons: Record<string, string> = {};
    for (const src of fold.scripts) {
      // NOTE: `getAttribute('src')` is protocol-relative (`//host/path`) for
      // Shopify theme assets, so it MUST be resolved against the page origin.
      const abs = src.startsWith("//") ? `https:${src}` : src;
      const b = urlToCandidates(abs, url);
      b.kept.forEach((t) => {
        foldScripts.push(t);
        foldReasons[t] = fold.reasons[src] || "ancestor-fold";
      });
    }

    // ---- coverage verdict: three-way, because coverage is not a boolean ----
    // A loaded script has ALWAYS executed its top-level code, so the whole-file
    // block-coverage entry (`fn: ""`) is true for every loaded script and says
    // nothing. Testing that entry alone marks every script as "used" and
    // empties deferArray. Testing only named functions instead is also wrong:
    // a purely top-level script (a custom-element definition, an IIFE that
    // wires behaviour immediately) runs real work but exposes no named
    // function, so it would be deferred. `unknown` is therefore protected.
    const coverageRan: string[] = [];
    const coverageUnknown: string[] = [];
    for (const entry of initialCoverage) {
      const verdict = coverageVerdict(entry);
      if (verdict === "idle") continue;
      const b = urlToCandidates(entry.url, url);
      b.kept.forEach((t) => {
        if (verdict === "ran") coverageRan.push(t);
        else coverageUnknown.push(t);
      });
    }

    // Fold / coverage sets can arrive in any source order, so bucket everything
    // here in one place rather than at each call site.
    const neverDefer: string[] = [];
    const noise: string[] = [];
    const selfScripts: string[] = [];
    const mergedKept = new Set<string>([...read.p, ...requestTokens]);
    for (const u of allScriptUrls) {
      const b = urlToCandidates(u, url);
      b.neverDefer.forEach((t) => neverDefer.push(t));
      b.noise.forEach((t) => noise.push(t));
      b.self.forEach((t) => selfScripts.push(t));
    }

    const inPageTokens = new Set<string>();
    for (const u of [...inPageSources.dom, ...inPageSources.rt]) {
      const abs = u.startsWith("//") ? `https:${u}` : u;
      const b = urlToCandidates(abs, url);
      b.kept.forEach((t) => inPageTokens.add(t));
    }
    const requestOnly = [...requestTokens].filter((t) => !inPageTokens.has(t)).length;
    const disagreement = [...inPageTokens].filter((t) => !requestTokens.has(t)).length;

    page.off("request", onRequest);
    page.off("response", onResponse);

    const pathname = safePathname(url);
    const pageNeverDefer = isNeverDeferPathname(pathname);
    type TimedResourceRow = {
      url: string;
      transferSize?: number;
      encodedBodySize?: number;
      decodedBodySize?: number;
      duration?: number;
      pathname: string;
      requestOrder?: number;
      startTime?: number;
      tbtContributionMs?: number;
    };
    const timedRows: TimedResourceRow[] = await page
      .evaluate((pagePath) => {
        const rows: Array<{
          url: string;
          transferSize?: number;
          encodedBodySize?: number;
          decodedBodySize?: number;
          duration?: number;
          pathname: string;
          requestOrder?: number;
          startTime?: number;
        }> = [];
        const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
        const scripts = entries
          .filter((e) => e.initiatorType === "script" || /\.js(\?|$)/i.test(e.name))
          .sort((a, b) => a.startTime - b.startTime);
        let order = 0;
        for (const e of scripts) {
          order += 1;
          rows.push({
            url: e.name,
            transferSize: e.transferSize,
            encodedBodySize: e.encodedBodySize,
            decodedBodySize: e.decodedBodySize,
            duration: e.duration,
            startTime: e.startTime,
            requestOrder: order,
            pathname: pagePath as string,
          });
        }
        return rows;
      }, pathname)
      .catch(() => [] as TimedResourceRow[]);
    const seenTimed = new Set(timedRows.map((row) => row.url));
    let nextOrder = timedRows.length;
    for (const scriptUrl of requestScripts) {
      if (seenTimed.has(scriptUrl)) continue;
      nextOrder += 1;
      timedRows.push({
        url: scriptUrl,
        pathname,
        requestOrder: nextOrder,
      });
    }
    for (const row of timedRows) {
      const measured = responseBytes.get(row.url);
      if (measured && measured > (row.transferSize || 0)) row.transferSize = measured;
    }

    if (!harvestOnly) {
      const longTaskData = await page
        .evaluate(() => {
          return new Promise<Array<{ start: number; duration: number }>>((resolve) => {
            const tasks: Array<{ start: number; duration: number }> = [];
            try {
              new PerformanceObserver((list) => {
                list.getEntries().forEach((e) => {
                  if (e.duration > 50) {
                    tasks.push({ start: e.startTime, duration: e.duration });
                  }
                });
              }).observe({ type: "longtask", buffered: true });
            } catch {
              // ignore
            }
            setTimeout(() => resolve(tasks), 120);
          });
        })
        .catch(() => [] as Array<{ start: number; duration: number }>);
      for (const task of longTaskData) {
        const blockingTime = task.duration - 50;
        if (blockingTime <= 0) continue;
        for (const row of timedRows) {
          const scriptStart = row.startTime ?? 0;
          const scriptEnd = scriptStart + (row.duration ?? 0);
          if (scriptEnd > task.start && scriptStart < task.start + task.duration) {
            row.tbtContributionMs = (row.tbtContributionMs ?? 0) + blockingTime;
          }
        }
      }
    }

    const domMutationCount = harvestOnly
      ? 0
      : await page
          .evaluate(() => (window as unknown as { __ppMutations?: number }).__ppMutations ?? 0)
          .catch(() => 0);

    if (pageNeverDefer) {
      for (const t of [...mergedKept]) {
        neverDefer.push(t);
        mergedKept.delete(t);
      }
    }

    return {
      context,
      page,
      resourceRows: timedRows,
      loadHintsByToken,
      acc: {
        p: [...mergedKept],
        vis: [...new Set([...read.vis, ...fold.selectors, ...revealedByInteraction])],
        off: read.off,
        foldScripts: [...new Set(foldScripts)],
        foldReasons,
        coverageRan: [...new Set(coverageRan)],
        coverageUnknown: [...new Set(coverageUnknown)],
        neverDefer: [...new Set(neverDefer)],
        noise: [...new Set(noise)],
        selfScripts: [...new Set(selfScripts)],
        sources: {
          request: allScriptUrls.size,
          dom: inPageSources.dom.length,
          resourceTiming: inPageSources.rt.length,
          requestOnly,
          disagreement,
        },
        settle: {
          lastScriptResponseEnd: Math.round(
            Math.max(preSettle.lastResponseEnd, postSettle.lastResponseEnd),
          ),
          preInteractionWaitMs: preSettle.waitMs,
          postInteractionWaitMs: postSettle.waitMs,
          postInteractionDelta,
          scrollSteps: interaction.steps,
          clicks: interaction.clicks,
          hitSafetyNet: preSettle.hitSafetyNet || postSettle.hitSafetyNet,
          domMutationCount,
        },
      },
    };
  } catch (err) {
    await context.close().catch(() => {});
    throw err;
  }
}

// Mirrors `isMajor` / `isVisible` from the audit script (audit-script.ts) so
// the check below uses exactly the same notion of "a visible section".
