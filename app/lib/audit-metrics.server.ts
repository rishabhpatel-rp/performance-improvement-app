import type { Page } from "playwright";
import type { LabVitalsEntry } from "./audit-report-types";

/** D2=B — mobile lab: Slow 4G + CPU 4× when enabled (default on). */
export async function applyMobileLabThrottling(page: Page) {
  if (process.env.AUDIT_LAB_THROTTLE === "false") return;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable").catch(() => {});
  await cdp
    .send("Network.emulateNetworkConditions", {
      offline: false,
      downloadThroughput: (400 * 1024) / 8,
      uploadThroughput: (400 * 1024) / 8,
      latency: 400,
    })
    .catch(() => {});
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 }).catch(() => {});
}

/** In-page lab vitals (mobile profile). CLS is unitless (decimal). */
export const COLLECT_LAB_VITALS_JS = `
(function () {
  return new Promise(function (resolve) {
    var out = { profile: "mobile", capturedAt: new Date().toISOString() };
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav) {
        out.ttfb = nav.responseStart;
        out.dcl = nav.domContentLoadedEventEnd;
      }
      var paints = performance.getEntriesByType("paint");
      for (var i = 0; i < paints.length; i++) {
        if (paints[i].name === "first-contentful-paint") out.fcp = paints[i].startTime;
      }
    } catch (e) {}

    var cls = 0;
    var longTasks = 0;
    var lcp = 0;
    var done = false;
    function finish() {
      if (done) return;
      done = true;
      out.cls = cls;
      out.longTaskCount = longTasks;
      if (lcp) out.lcp = lcp;
      resolve(out);
    }

    try {
      if (typeof PerformanceObserver !== "undefined") {
        try {
          new PerformanceObserver(function (list) {
            for (var e of list.getEntries()) {
              if (e.entryType === "layout-shift" && !e.hadRecentInput) cls += e.value;
              if (e.entryType === "longtask") longTasks++;
              if (e.entryType === "largest-contentful-paint") lcp = e.startTime;
            }
          }).observe({ type: "layout-shift", buffered: true });
          new PerformanceObserver(function (list) {
            for (var e of list.getEntries()) {
              if (e.entryType === "largest-contentful-paint") lcp = e.startTime;
            }
          }).observe({ type: "largest-contentful-paint", buffered: true });
          new PerformanceObserver(function (list) {
            for (var e of list.getEntries()) if (e.entryType === "longtask") longTasks++;
          }).observe({ type: "longtask", buffered: true });
        } catch (e) {}
      }
    } catch (e) {}

    setTimeout(finish, 1200);
  });
})();
`;

export function emptyLabVitals(profile: "mobile" | "desktop" = "mobile"): LabVitalsEntry {
  return { profile, capturedAt: new Date().toISOString() };
}
