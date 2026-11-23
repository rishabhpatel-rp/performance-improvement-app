/** Lightweight runtime error capture appended to the performance script (G-1). */
export const STOREFRONT_ERROR_MONITOR_SNIPPET = `
(function () {
  if (!navigator.sendBeacon) return;
  var endpoint = "/apps/performance-scripts/api/storefront-runtime-errors";
  var errList = [];
  var flushed = false;
  function capture(type, data) {
    if (errList.length < 10) errList.push({ t: type, d: String(data).slice(0, 200), ts: Date.now() });
  }
  window.addEventListener("error", function (e) {
    capture("err", (e.message || "") + " " + (e.filename || "") + ":" + (e.lineno || ""));
  });
  window.addEventListener("unhandledrejection", function (e) {
    capture("rej", String(e.reason || "").slice(0, 200));
  });
  function flush() {
    if (flushed || !errList.length) return;
    flushed = true;
    try {
      navigator.sendBeacon(endpoint, JSON.stringify({ errors: errList }));
    } catch (e) {
      void e;
    }
  }
  setTimeout(flush, 8000);
  window.addEventListener("pagehide", flush);
})();
`;
