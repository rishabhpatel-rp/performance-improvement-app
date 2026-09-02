// Public App Proxy endpoint that serves the storefront injectable script.
//
// This is the ONLY client-side injection mechanism. The theme extension block
// (performance_scripts.liquid) loads a thin loader whose src resolves through
// the App Proxy to this route, and this route returns a single JavaScript
// bundle built on the backend.
//
// The storefront never receives our data, logic, or config: the bundle is
// assembled server-side from the shop's own config metaobject (via the
// authenticated Admin API). For now it injects 2 dummy scripts and 1 style
// block into the head to exercise the delivery path. Nothing is collected,
// blocked, or hidden. Real logic is added before launch.
import { authenticate } from "../shopify.server";
import { getConfig } from "../lib/metaobjects";

const JS_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

/**
 * Dummy bundle. When the app is enabled, injects into <head>:
 *   - 2 placeholder <script> elements (no-op bodies)
 *   - 1 placeholder <style> block (no-op CSS)
 * These do NOT collect data, block scripts, or hide anything on the
 * storefront. Replace before go-live.
 */
function buildDummyBundle({ appEnabled, debugMode }) {
  // Dummy script 1 (no-op placeholder).
  const scriptBody1 = `
    (function () {
      // TODO(real): script 1 logic.
    })();
  `;

  // Dummy script 2 (no-op placeholder).
  const scriptBody2 = `
    (function () {
      // TODO(real): script 2 logic.
    })();
  `;

  // Dummy style block (no-op CSS, does not affect the storefront layout).
  const styleCss = `
    /* Performance App dummy styles - no-op placeholder. */
  `;

  return `/* Backend-served Performance App bundle (dummy injection). */
window.PerformanceApp = window.PerformanceApp || { appEnabled: ${appEnabled}, version: "1.0.0-dummy" };
(function () {
  var head = document.head || document.documentElement;
  console.log("[perf-app] bundle loaded", { appEnabled: ${appEnabled}, debugMode: ${debugMode} });
  if (!${appEnabled}) {
    console.log("[perf-app] app disabled, skipping injection.");
    return;
  }

  function injectScript(id, code) {
    if (document.getElementById(id)) {
      console.log("[perf-app] already present, skipping", id);
      return;
    }
    var s = document.createElement("script");
    s.id = id;
    s.type = "text/javascript";
    s.textContent = code;
    head.appendChild(s);
    console.log("[perf-app] injected", id);
  }

  function injectStyle(id, css) {
    if (document.getElementById(id)) {
      console.log("[perf-app] already present, skipping", id);
      return;
    }
    var st = document.createElement("style");
    st.id = id;
    st.type = "text/css";
    st.textContent = css;
    head.appendChild(st);
    console.log("[perf-app] injected", id);
  }

  injectScript("perf-script-1", ${JSON.stringify(scriptBody1)});
  injectScript("perf-script-2", ${JSON.stringify(scriptBody2)});
  injectStyle("perf-style", ${JSON.stringify(styleCss)});

  console.log("[perf-app] done. In head now:", {
    script1: !!document.getElementById("perf-script-1"),
    script2: !!document.getElementById("perf-script-2"),
    style: !!document.getElementById("perf-style"),
  });
})();
`;
}

export const loader = async ({ request }) => {
  try {
    const auth = await authenticate.public.appProxy(request);
    if (!auth) {
      // Not a valid proxy request - return a silent no-op script so the
      // storefront does not throw a console error.
      return new Response("// no scripts", { status: 200, headers: JS_HEADERS });
    }

    const shop = auth?.session?.shop;
    let appEnabled = false;
    let debugMode = false;

    // Read config entirely on the server, using the app proxy's admin client
    // when an offline session exists. Best-effort: if the proxy has no
    // session/admin or the metaobject is missing, we still serve a bundle
    // (with the app implicitly "off") rather than erroring.
    try {
      if (shop && auth.admin) {
        const config = await getConfig(auth.admin);
        appEnabled = config.appEnabled;
        debugMode = config.debugMode;
      }
    } catch (err) {
      if (shop) {
        console.warn(
          `[api.script] Could not resolve config for ${shop}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }

    const body = buildDummyBundle({ appEnabled, debugMode });
    return new Response(body, { status: 200, headers: JS_HEADERS });
  } catch (error) {
    console.error("[api.script] Error building bundle:", error);
    return new Response(
      `console.error("[api.script] Failed to load script", ${JSON.stringify(
        error instanceof Error ? error.message : String(error),
      )});`,
      { status: 200, headers: JS_HEADERS },
    );
  }
};
