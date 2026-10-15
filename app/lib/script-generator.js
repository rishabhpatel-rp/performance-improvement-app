import { createHash } from "node:crypto";
import JavaScriptObfuscator from "javascript-obfuscator";

export function parseToArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;

  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {
    // Ignore JSON parse errors, fall back to string splitting
  }

  return String(input)
    .split(/[\n,]+/)
    .map((item) => item.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/**
 * Hide lastfold selectors until html.interacted is set.
 * Example: html:not(.interacted) :is(#footer,.grid>:nth-child(n+5)){display:none!important}
 */
export function buildHiddenCss(selectors) {
  const list = (Array.isArray(selectors) ? selectors : [])
    .map((selector) => String(selector || "").trim())
    .filter(Boolean);
  if (!list.length) return "";
  return (
    "html:not(.interacted) :is(" +
    list.join(",") +
    "){display:none!important}"
  );
}

/**
 * Builds the RAW (un-obfuscated) storefront script source for one store.
 *
 * Cheap (string templating only). Obfuscation is the expensive step and lives
 * in `obfuscateRawScript`; `generateDeferredScript` runs both. Splitting them
 * lets the caller fingerprint the raw source and skip obfuscation entirely when
 * nothing changed.
 *
 * Every list holds URL fragments; a <script src> whose URL contains one of
 * them is matched (as a regex-escaped alternation).
 *
 * PER-PAGE GATING
 * A store serves thousands of PDPs but an audit only ever sees three URLs, so
 * the bundle carries one variant per audited page plus a match pattern that
 * generalises it to its siblings (`/products/gift-card` -> `/products/`). The
 * script resolves `location.pathname` against those patterns **once, at install
 * time**, and gates only what that page needs. One request, one cache entry, no
 * per-page round trip.
 *
 * The shared part is sent once as `baseScripts` (the intersection of the audited
 * pages) and each variant carries only its `add` delta. Shipping full per-page
 * lists instead measured +65% bundle size for a script that blocks rendering on
 * every page load — for a store where most scripts are shared, the delta is a
 * handful of entries instead of hundreds.
 *
 * @param {object}   options
 * @param {string[]} options.baseScripts  Scripts every audited page loads. Gated
 *   on every page. Sent once.
 * @param {Array<{pattern: string, add?: string[], hide?: string[]}>}
 *   options.pageVariants  Per-page additions, ordered most specific first. The
 *   first pattern matching `location.pathname` wins.
 * @param {string[]} options.interactionGatedScripts  Fallback union used when no
 *   variant matches. Blocked until the visitor's first interaction. Source:
 *   auditDeferArray.
 * @param {string[]} options.firstVisitDelayedScripts Held for FIRST-TIME visitors
 *   only, until interaction or `firstVisitDelayMs` (localStorage flag makes it a
 *   no-op on later visits). Source: firstUserDelayScripts.
 * @param {string[]} options.everyLoadDelayedScripts  Held on EVERY page load and
 *   released after `everyLoadDelayMs`. Source: staticDeferDefaults.
 * @param {number}   options.firstVisitDelayMs        Timeout for the first-visit list.
 * @param {number}   options.everyLoadDelayMs         Timeout for the every-load list.
 * @param {string[]} options.hideSelectors            Fallback hide list when no
 *   variant matches. Source: auditHideSelectors.

 * @returns {string} Raw (un-obfuscated) JavaScript source.
 */
export function buildRawScript({
  baseScripts = [],
  pageVariants = [],
  interactionGatedScripts = [],
  firstVisitDelayedScripts = [],
  everyLoadDelayedScripts = [],
  firstVisitDelayMs = 12000,
  everyLoadDelayMs = 6000,
  hideSelectors = [],
} = {}) {
  // Intern identical selector lists. They are small, but a store whose pages
  // share the same below-fold sections would otherwise repeat them per variant.
  const hideSets = [];
  const internHide = (list) => {
    const key = JSON.stringify(list);
    const hit = hideSets.findIndex((e) => e.key === key);
    if (hit !== -1) return hit;
    hideSets.push({ key, list });
    return hideSets.length - 1;
  };
  const variants = pageVariants.map((v) => ({
    pattern: v.pattern,
    add: v.add || [],
    hideIndex: internHide(v.hide || []),
    firstUserAdd: v.firstUserAdd || [],
    everyAdd: v.everyAdd || [],
    firstUserDelayMs: v.firstUserDelayMs,
    everyLoadDelayMs: v.everyLoadDelayMs,
  }));
  const fallbackHideIndex = internHide(hideSelectors);

  const baseJson = JSON.stringify(baseScripts);
  const fallbackUnionJson = JSON.stringify(interactionGatedScripts);
  const hideSetsJson = JSON.stringify(hideSets.map((e) => e.list));
  const variantsJson = JSON.stringify(variants);
  const fallbackJson = JSON.stringify({ hide: fallbackHideIndex });
  const firstVisitDelayedJson = JSON.stringify(firstVisitDelayedScripts);
  const everyLoadDelayedJson = JSON.stringify(everyLoadDelayedScripts);

  // Source script template
  const rawScript = `
  (function () {
    "use strict";
    // Mirrors buildHiddenCss() on the build side, but per page. Kept here as
    // source rather than inlined so the selector list is interned once.
    function buildPageCss(sel) {
      var list = [];
      for (var i = 0; i < sel.length; i++) {
        var s = String(sel[i] || "").trim();
        if (s) list.push(s);
      }
      if (!list.length) return "";
      return (
        "html:not(.interacted) :is(" + list.join(",") +
        "){display:none!important}"
      );
    }
    var doc = document;
    var docEl = document.documentElement;
    var classList = docEl.classList;
    var win = window;
    var startTime = performance.now();

    // ---- resolve which page this is, once ----
    // Everything below gates only what THIS page needs. Without this, a PDP
    // would be handed the PLP's list (and vice versa), so the visitor would
    // either get scripts that should have run or wait for ones that were never
    // going to be needed.
    var BASE = ${baseJson};
    var UNION = ${fallbackUnionJson};
    var HIDE_SETS = ${hideSetsJson};
    var VARIANTS = ${variantsJson};
    var FALLBACK = ${fallbackJson};
    var PATH = location.pathname || "/";

    function resolvePage() {
      for (var i = 0; i < VARIANTS.length; i++) {
        var p = VARIANTS[i].pattern;
        if (!p) continue;
        // A pattern ending in "/" is a section prefix and generalises to sibling
        // pages; anything else must match the path exactly. VARIANTS is ordered
        // most specific first, so the first hit wins.
        if (p.charAt(p.length - 1) === "/") {
          if (PATH.indexOf(p) === 0) return VARIANTS[i];
        } else if (PATH === p || PATH === p + "/") {
          return VARIANTS[i];
        }
      }
      return null;
    }

    var PAGE = resolvePage();
    // BASE is what every audited page loads; the variant adds only this page's
    // extras. No match at all means an un-audited page (a blog post, a search
    // result): fall back to the union, which is the safe superset.
    var gatedTokens = PAGE ? BASE.concat(PAGE.add) : UNION;
    var activeSelectors = PAGE ? HIDE_SETS[PAGE.hideIndex] : HIDE_SETS[FALLBACK.hide];
    var hideCss = buildPageCss(activeSelectors || []);


    if (hideCss && !doc.getElementById("pp-hide-lastfold")) {
      try {
        var hideStyle = doc.createElement("style");
        hideStyle.id = "pp-hide-lastfold";
        hideStyle.appendChild(doc.createTextNode(hideCss));
        var hideParent = doc.head || docEl;
        if (hideParent.firstChild) {
          hideParent.insertBefore(hideStyle, hideParent.firstChild);
        } else {
          hideParent.appendChild(hideStyle);
        }
      } catch (e0) {}
    }
    var MIN_DELAY = 0;
    var interactionCaptured = false;
    var interactionApplied = false;
    var F_KEY = "__fInteractedDone";
    var fDone = false;

    try {
      fDone = localStorage.getItem(F_KEY) === "1";
    } catch (e) {}

    if (!fDone) {
      classList.add("f-interacted");
    }

    function applyInteraction(type) {
      if (interactionApplied) return;
      interactionApplied = true;
      classList.add("interacted");
      classList.remove("f-interacted");

      try {
        localStorage.setItem(F_KEY, "1");
      } catch (e) {}

      doc.dispatchEvent(new CustomEvent("site:interacted"));
    }

    function onFirstInteraction(type) {
      if (interactionCaptured) return;
      interactionCaptured = true;

      var elapsed = performance.now() - startTime;
      var remaining = MIN_DELAY - elapsed;

      if (remaining <= 0) {
        applyInteraction(type);
      } else {
        setTimeout(function () {
          applyInteraction(type);
        }, remaining);
      }
    }

    [
      "pointerdown",
      "click",
      "keydown",
      "touchstart",
      "wheel",
      "scroll",
      "mousemove",
      "focus"
    ].forEach(function (evt) {
      win.addEventListener(evt, function () {
        onFirstInteraction(evt);
      }, { once: true, passive: true, capture: true });
    });

    var P = gatedTokens;

    var R = P.length
      ? new RegExp(
          P.map(function (p) {
            return p.replace(/[.*+?^$\${}()|[\\]\\\\]/g, "\\\\$&");
          }).join("|")
        )
      : null;

    var H = function () {
      return classList.contains("interacted");
    };

    var S = Element.prototype.setAttribute;
    var A = Element.prototype.appendChild;
    var I = Element.prototype.insertBefore;
    var C = Node.prototype.replaceChild;
    var nativeSrcSet = Object.getOwnPropertyDescriptor(
      HTMLScriptElement.prototype,
      "src"
    ).set;

    function B(s) {
      if (!H() && s && "SCRIPT" === s.tagName) {
        var t = s.src || s.getAttribute("src") || "";
        if (t && R && R.test(t)) {
          if (!s.hasAttribute("data-type")) {
            s.setAttribute("data-type", s.getAttribute("type") || "");
          }
          s.type = "text/plain";
          s.removeAttribute("src");
          s._ps = t;
        }
      }
    }

    Element.prototype.appendChild = function (e) {
      if (e && "SCRIPT" === e.tagName) B(e);
      return A.call(this, e);
    };

    Element.prototype.insertBefore = function (e, t) {
      if (e && "SCRIPT" === e.tagName) B(e);
      return I.call(this, e, t);
    };

    Node.prototype.replaceChild = function (e, t) {
      if (e && "SCRIPT" === e.tagName) B(e);
      return C.call(this, e, t);
    };

    Element.prototype.setAttribute = function (e, t) {
      if ("SCRIPT" === this.tagName) {
        if ("src" === e) {
          var r = String(t || "");
          if (r && R && R.test(r)) {
            this._ps = r;
            this.type = "text/plain";
            this.removeAttribute("src");
            return;
          }
        }
        if ("type" === e && this.hasAttribute("data-type")) return;
      }
      return S.call(this, e, t);
    };

    if (window.__dsq) {
      window.__dsq.forEach(function (e) {
        if ("s" === e.t) {
          var t = String(e.v || "");
          if (t && R && R.test(t)) {
            e.e._ps = t;
            e.e.type = "text/plain";
            e.e.removeAttribute("src");
          }
        } else {
          B(e.e);
        }
      });
      window.__dsq = null;
    }

    if (window.__dsmo) {
      window.__dsmo.disconnect();
      window.__dsmo = null;
    }

    // Deliberately NO install-time sweep over the scripts already in the DOM.
    //
    // The gate itself has just executed, so every classic script[src] that
    // appears earlier in document order has ALREADY run, and anything later in
    // the document has not been parsed yet (so it is not in the DOM to find).
    // Parking the already-parsed ones and then re-creating them in
    // releaseGatedScripts() runs them a SECOND time, which throws
    // "Uncaught SyntaxError: Identifier 'X' has already been declared" for
    // every theme script that declares a top-level class or const — the Dawn
    // theme alone produced seven of these (pubsub, global, details-disclosure,
    // details-modal, search-form, standard-actions-override, animations).
    //
    // Scripts that arrive after the gate installed are caught by the observer
    // below, which is the only place parking can actually help.
    var O = new MutationObserver(function (t) {
      if (H()) {
        O.disconnect();
      } else {
        for (var e = 0; e < t.length; e++) {
          for (var r = t[e].addedNodes, s = 0; s < r.length; s++) {
            var n = r[s];
            if (1 === n.nodeType) {
              if ("SCRIPT" === n.tagName) B(n);
              if (n.querySelectorAll) {
                for (var a = n.querySelectorAll("script"), i = 0; i < a.length; i++) {
                  B(a[i]);
                }
              }
            }
          }
        }
      }
    });

    O.observe(docEl, { childList: true, subtree: true });

    function releaseGatedScripts() {
      O.disconnect();
      doc.querySelectorAll('script[type="text/plain"]').forEach(function (e) {
        // Only scripts parked by the observer above reach here, and those have
        // had their src stripped *before* the browser fetched them, so they have
        // definitely never executed and re-creating them is safe. Re-creating a
        // script that had already run is what produced the duplicate
        // "Identifier 'X' has already been declared" errors; that can no longer
        // happen now that the install-time sweep is gone.
        if (e._ps) {
          var t = doc.createElement("script");
          for (var r = 0; r < e.attributes.length; r++) {
            var s = e.attributes[r];
            if ("type" !== s.name && "src" !== s.name) {
              S.call(t, s.name, s.value);
            }
          }
          var n = e.getAttribute("data-type") || "";
          if (n) S.call(t, "type", n);
          S.call(t, "src", e._ps);
          A.call(doc.head, t);
          e.remove();
        }
      });
    }

    doc.addEventListener("site:interacted", releaseGatedScripts, { once: true });
    if (H()) releaseGatedScripts();

    (function () {
      var LS_KEY = "__wpmDelayDone";
      var alreadyRan = false;

      try {
        alreadyRan = localStorage.getItem(LS_KEY) === "1";
      } catch (e) {}

      if (alreadyRan) return;

      var GLOBAL_FIRST_VISIT_DELAYED = ${firstVisitDelayedJson};
      var GLOBAL_FIRST_VISIT_DELAY_MS = ${firstVisitDelayMs};
      var _firstAdd = PAGE && PAGE.firstUserAdd ? PAGE.firstUserAdd : [];
      var FIRST_VISIT_DELAYED_SCRIPTS = GLOBAL_FIRST_VISIT_DELAYED.concat(_firstAdd);
      // Empty list still used to wrap src/setAttribute for the whole page.
      if (!FIRST_VISIT_DELAYED_SCRIPTS.length) return;
      var _delay =
        PAGE && PAGE.firstUserDelayMs != null
          ? PAGE.firstUserDelayMs
          : GLOBAL_FIRST_VISIT_DELAY_MS;
      var fudRe = FIRST_VISIT_DELAYED_SCRIPTS.length
        ? new RegExp(
            FIRST_VISIT_DELAYED_SCRIPTS.map(function (p) {
              return p.replace(/[.*+?^$\${}()|[\\]\\\\]/g, "\\\\$&");
            }).join("|")
          )
        : null;

      var hold = [];
      var released = false;
      var srcDesc = Object.getOwnPropertyDescriptor(
        HTMLScriptElement.prototype,
        "src"
      );
      var origSrc = srcDesc.set;
      var origSetAttr = Element.prototype.setAttribute;

      function isFirstDelayUrl(v) {
        v = String(v || "");
        return !!(fudRe && fudRe.test(v));
      }

      function markDone() {
        try {
          localStorage.setItem(LS_KEY, "1");
        } catch (e) {}
      }

      function holdScript(el, url) {
        if (el._wpmheld || released) return;
        el._wpmheld = 1;
        el._ps = url;
        origSetAttr.call(el, "data-wpm-deferred", "1");
        hold.push(el);
      }

      function releaseHeld() {
        for (var i = 0; i < hold.length; i++) {
          var el = hold[i];
          if (el && el._wpmheld) {
            el.removeAttribute("data-wpm-deferred");
            el._wpmheld = 0;
            origSrc.call(el, el._ps);
          }
        }
        hold = [];
      }

      Object.defineProperty(HTMLScriptElement.prototype, "src", {
        configurable: true,
        get: function () {
          return srcDesc.get.call(this);
        },
        set: function (v) {
          if (!this._wpmheld && !released && isFirstDelayUrl(v)) {
            return void holdScript(this, v);
          }
          return origSrc.call(this, v);
        }
      });

      Element.prototype.setAttribute = function (n, v) {
        if (
          "SCRIPT" === this.tagName &&
          "src" === n &&
          !this._wpmheld &&
          !released &&
          isFirstDelayUrl(v)
        ) {
          return void holdScript(this, v);
        }
        return origSetAttr.call(this, n, v);
      };

      function rel() {
        if (released) return;
        released = true;
        releaseHeld();
        markDone();
      }

      [
        "pointerdown",
        "keydown",
        "touchstart",
        "wheel",
        "scroll",
        "mousemove",
        "focus"
      ].forEach(function (e) {
        window.addEventListener(e, rel, { once: true, passive: true, capture: true });
      });

      setTimeout(rel, _delay);
    })();

    (function () {
      var GLOBAL_EVERY_LOAD_DELAYED = ${everyLoadDelayedJson};
      var GLOBAL_EVERY_LOAD_DELAY_MS = ${everyLoadDelayMs};
      var _everyAdd = PAGE && PAGE.everyAdd ? PAGE.everyAdd : [];
      var EVERY_LOAD_DELAYED_SCRIPTS = GLOBAL_EVERY_LOAD_DELAYED.concat(_everyAdd);
      if (!EVERY_LOAD_DELAYED_SCRIPTS.length) return;
      var _etDelay =
        PAGE && PAGE.everyLoadDelayMs != null
          ? PAGE.everyLoadDelayMs
          : GLOBAL_EVERY_LOAD_DELAY_MS;

      var etRe = EVERY_LOAD_DELAYED_SCRIPTS.length
        ? new RegExp(
            EVERY_LOAD_DELAYED_SCRIPTS.map(function (p) {
              return p.replace(/[.*+?^$\${}()|[\\]\\\\]/g, "\\\\$&");
            }).join("|")
          )
        : null;

      var heldET = [];
      var etReleased = false;

      function isETUrl(v) {
        v = String(v || "");
        return !!(etRe && etRe.test(v));
      }

      function holdScriptET(el, url) {
        if (etReleased || el._etHeld) return;
        el._etHeld = 1;
        el._ps = url;
        S.call(el, "data-et-deferred", "1");
        heldET.push(el);
      }

      function releaseHeldET() {
        for (var i = 0; i < heldET.length; i++) {
          var el = heldET[i];
          if (el && el._etHeld) {
            el.removeAttribute("data-et-deferred");
            el._etHeld = 0;
            nativeSrcSet.call(el, el._ps);
          }
        }
        heldET = [];
      }

      var curSrcDesc = Object.getOwnPropertyDescriptor(
        HTMLScriptElement.prototype,
        "src"
      );
      var curSrcGetter = curSrcDesc.get;
      var curSrcSetter = curSrcDesc.set;
      var curSetAttr = Element.prototype.setAttribute;

      Object.defineProperty(HTMLScriptElement.prototype, "src", {
        configurable: true,
        get: function () {
          return curSrcGetter.call(this);
        },
        set: function (v) {
          if (!etReleased && isETUrl(v)) return void holdScriptET(this, v);
          return curSrcSetter.call(this, v);
        }
      });

      Element.prototype.setAttribute = function (n, v) {
        if ("SCRIPT" === this.tagName && "src" === n && !etReleased && isETUrl(v)) {
          return void holdScriptET(this, v);
        }
        return curSetAttr.call(this, n, v);
      };

      setTimeout(function () {
        etReleased = true;
        releaseHeldET();
      }, _etDelay);
    })();
  })();
  `;

  return rawScript;
}

/**
 * Bump when something outside the raw source / profile changes the final bytes
 * (e.g. a javascript-obfuscator upgrade) and every store should be rebuilt.
 */
export const SCRIPT_BUILD_REVISION = "1";

/**
 * Obfuscation profile. The script is rendered INLINE in the <head> of every
 * storefront page (via a shop metafield), so size is paid on every HTML
 * response: this is the small-size profile (~19 KB raw / ~7 KB gzip).
 *
 * To make it stronger later, change it here only. Anything that ends up above
 * INLINE_CAPACITY_CHARS (script-inline.js) is not inlined (there is no proxy
 * fallback any more, so nothing is printed). Changing this object changes the
 * build fingerprint, so every store is rebuilt the next time it is saved or
 * reconciled.
 *
 * `disableConsoleOutput` and `seed` are applied per build (debug mode / shop).
 */
export const OBFUSCATION_PROFILE = Object.freeze({
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.3,
  deadCodeInjection: false,
  debugProtection: false,
  identifierNamesGenerator: "hexadecimal",
  renameGlobals: false,
  selfDefending: false,
  stringArray: true,
  stringArrayEncoding: ["base64"],
  stringArrayThreshold: 0.75,
});

/**
 * Fingerprint of everything that determines the final bytes: the raw source
 * (which already contains every list/delay/selector), the profile, the build
 * revision, debug mode, the seed and the timing-log wrapper. Equal fingerprint
 * means an identical script, so the stored one can be reused as-is.
 *
 * @param {string} rawScript
 * @param {{debugMode?: boolean, seed?: number}} [opts]
 * @returns {string}
 */
export function fingerprintRawScript(rawScript, { debugMode = false, seed = 0 } = {}) {
  // Every wrapper that will be added to the stored bytes has to be part of the
  // fingerprint, otherwise flipping TEMP_TIMING_LOG / TEMP_TIMING_PROBE would
  // produce identical hashes and the store would keep serving the old script.
  const wrappers = [];
  if (TEMP_TIMING_LOG || debugMode) wrappers.push(withTimingLog.toString());
  if (TEMP_TIMING_PROBE) wrappers.push(withTimingProbe.toString());
  return createHash("sha256")
    .update(
      JSON.stringify({
        rawScript,
        profile: OBFUSCATION_PROFILE,
        revision: SCRIPT_BUILD_REVISION,
        debugMode: Boolean(debugMode),
        seed: seed || 0,
        timing: wrappers.length ? wrappers.join("\n") : null,
      }),
    )
    .digest("hex");
}

/**
 * Server-side obfuscation of a raw script. CPU-heavy, so callers run it once
 * per input change and store the result; it is never run per request, and the
 * stored string is what gets mirrored into the shop metafield as-is.
 *
 * @param {string} rawScript
 * @param {{debugMode?: boolean, seed?: number}} [opts]
 * @returns {string} Obfuscated JavaScript.
 */
export function obfuscateRawScript(rawScript, { debugMode = false, seed = 0 } = {}) {
  const keepConsoleOutput = Boolean(debugMode || TEMP_TIMING_LOG);
  const obfuscatedResult = JavaScriptObfuscator.obfuscate(rawScript, {
    ...OBFUSCATION_PROFILE,
    // Keep console timing output when the uploader is intentionally in debug or
    // timing-measurement mode; otherwise it is still stripped from the bundle.
    disableConsoleOutput: !keepConsoleOutput,
    // A stable seed makes identical input produce identical output.
    ...(seed ? { seed } : {}),
  });

  const obfuscated = obfuscatedResult.getObfuscatedCode();
  let out = obfuscated;
  // Probe outermost so its `exec` timestamp is taken before anything the logger
  // adds, and `ready` after everything.
  if (TEMP_TIMING_PROBE) out = withTimingProbe(out);
  if (TEMP_TIMING_LOG || debugMode) out = withTimingLog(out);
  return out;
}

/**
 * Build + obfuscate in one call (kept for callers that do not need the
 * fingerprint/skip logic). `seed` and `debugMode` are consumed by obfuscation;
 * everything else is forwarded to `buildRawScript`.
 *
 * @param {Parameters<typeof buildRawScript>[0] & {debugMode?: boolean, seed?: number}} [options]
 * @returns {string} Obfuscated JavaScript.
 */
export function generateDeferredScript(options = {}) {
  const { debugMode = false, seed = 0, ...rest } = options;
  return obfuscateRawScript(buildRawScript(rest), { debugMode, seed });
}

// ---------------------------------------------------------------------------
// TEMPORARY — injection timing log. Set TEMP_TIMING_LOG to false (or delete
// this block and the withTimingLog call above) once you have the numbers,
// then rebuild the script (toggle the app off/on or save a Step 2 field).
//
// Kept OUTSIDE the obfuscated code on purpose: the obfuscator option
// disableConsoleOutput replaces console.log with a no-op for everything that
// runs after it, so the logger captures a bound console.log first.
// ---------------------------------------------------------------------------
// The injection-timing log costs bytes and keeps console output in a script
// that blocks rendering on every storefront page load. Off unless the store's
// debug mode is on (that path still wraps with withTimingLog).
export const STOREFRONT_TIMING_LOG_ENABLED = false;
const TEMP_TIMING_LOG = STOREFRONT_TIMING_LOG_ENABLED;

// TEST-ONLY. Set to true, save any Step 2 field (or toggle the app off/on) to
// force a rebuild, then read the numbers in DevTools with:
//
//   __ppTiming
//
// Unlike `withTimingLog` this publishes to a plain object on `window` instead of
// `console.log`, for two reasons:
//
//   1. It survives the obfuscator. With `disableConsoleOutput` on (every
//      non-debug build) javascript-obfuscator rewrites `console.*` into no-ops,
//      so a console-based probe would print nothing at all. A plain object
//      assignment is untouched.
//   2. It needs no per-request interaction, so it can be read after the fact
//      rather than watched for while the page loads.
//
// The two flags are independent and can be combined; the probe is outermost.
//
// All times are `performance.now()`, i.e. milliseconds since navigation start:
//   exec        script began executing        <- proves the inline path costs 0 RTT
//   ready       gate fully installed          <- "ready to use"
//   installMs   ready - exec, the install cost itself
//   dcl         DOMContentLoaded
//   load        window load
//   fcp         first-contentful-paint
//   ttfb        navigation responseStart (HTML first byte)
//   htmlEnd     navigation responseEnd
//   scriptsBefore <script> tags parsed ahead of this one (0-ish => near top of head)
//   readyState  document.readyState when the script ran
//
// Flip back to false when done: these are un-obfuscated bytes added to a script
// that blocks rendering on every page load.
const TEMP_TIMING_PROBE = false;

function withTimingProbe(obfuscated) {
  const before = `
  var P = (window.__ppTiming = window.__ppTiming || {});
  try {
    P.exec = performance.now();
    P.readyState = document.readyState;
    P.scriptsBefore = document.getElementsByTagName("script").length - 1;
    var nav = performance.getEntriesByType("navigation")[0];
    if (nav) {
      P.ttfb = Math.round(nav.responseStart);
      P.htmlEnd = Math.round(nav.responseEnd);
      P.htmlBytes = nav.encodedBodySize;
      P.htmlFromCache = nav.transferSize === 0 && nav.encodedBodySize > 0;
    }
  } catch (e) {}
  `;
  const after = `
  try {
    var P2 = window.__ppTiming;
    if (P2 && typeof P2.exec === "number") {
      P2.ready = performance.now();
      P2.installMs = Math.round((P2.ready - P2.exec) * 100) / 100;
    }
  } catch (e) {}
  document.addEventListener("DOMContentLoaded", function () {
    try { window.__ppTiming.dcl = performance.now(); } catch (e) {}
  });
  window.addEventListener("load", function () {
    try {
      var P3 = window.__ppTiming;
      var fcp = performance.getEntriesByName("first-contentful-paint")[0];
      P3.load = performance.now();
      P3.fcp = fcp ? fcp.startTime : null;
    } catch (e) {}
  });
  `;
  return "(function () {" + before + "\n" + obfuscated + "\n;" + after + "})();";
}

function withTimingLog(obfuscated) {
  const before = `
  var pp = { log: null, t0: 0, tag: "[PagePulse] " };
  try {
    pp.log = console.log.bind(console);
    pp.t0 = performance.now();
    var rt = null;
    var resourceLine = function () {
      try {
        var list = performance.getEntriesByType("resource");
        for (var i = 0; i < list.length; i++) {
          if (list[i].name.indexOf("/apps/performance-scripts") !== -1) { rt = list[i]; break; }
        }
        if (!rt) return "";
        var fromCache = rt.transferSize === 0 && rt.decodedBodySize > 0;
        return "script file: requested at " + rt.requestStart.toFixed(0) + " ms, finished at " +
          rt.responseEnd.toFixed(0) + " ms (download " + (rt.responseEnd - rt.startTime).toFixed(0) +
          " ms, " + (rt.encodedBodySize / 1024).toFixed(1) + " KB, " + (fromCache ? "from browser cache" : "from network") + ")";
      } catch (e) { return ""; }
    };
    pp.log(pp.tag + "script started executing " + pp.t0.toFixed(0) + " ms after navigation start" +
      " (readyState: " + document.readyState + ", <script> tags parsed before it: " +
      (document.getElementsByTagName("script").length - 1) + ")");
    var line = resourceLine();
    if (line) pp.log(pp.tag + line);
    document.addEventListener("DOMContentLoaded", function () {
      var now = performance.now();
      pp.log(pp.tag + "DOMContentLoaded at " + now.toFixed(0) + " ms (" + (now - pp.t0).toFixed(0) + " ms after the script started)");
    });
    window.addEventListener("load", function () {
      var now = performance.now();
      var fcp = performance.getEntriesByName("first-contentful-paint")[0];
      pp.log(pp.tag + "window load at " + now.toFixed(0) + " ms; first-contentful-paint: " +
        (fcp ? fcp.startTime.toFixed(0) + " ms" : "n/a") +
        (fcp ? (fcp.startTime > pp.t0 ? " (script ran BEFORE first paint)" : " (script ran AFTER first paint)") : ""));
      if (!line) { line = resourceLine(); if (line) pp.log(pp.tag + line); }
    });
  } catch (e) { pp.log = null; }
  `;
  const after = `
  try {
    if (pp.log) pp.log(pp.tag + "defer logic installed in " + (performance.now() - pp.t0).toFixed(1) + " ms");
  } catch (e) {}
  `;
  return "(function () {" + before + "\n" + obfuscated + "\n;" + after + "})();";
}
