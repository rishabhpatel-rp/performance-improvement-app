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
 * Builds the obfuscated storefront script for one store.
 *
 * Every list holds URL fragments; a <script src> whose URL contains one of
 * them is matched (as a regex-escaped alternation).
 *
 * @param {object}   options
 * @param {string[]} options.interactionGatedScripts  Blocked until the visitor's
 *   first interaction (pointer, scroll, key, touch...). Source: auditDeferArray.
 * @param {string[]} options.firstVisitDelayedScripts Held for FIRST-TIME visitors
 *   only, until interaction or `firstVisitDelayMs` (localStorage flag makes it a
 *   no-op on later visits). Source: firstUserDelayScripts.
 * @param {string[]} options.everyLoadDelayedScripts  Held on EVERY page load and
 *   released after `everyLoadDelayMs`. Source: staticDeferDefaults.
 * @param {number}   options.firstVisitDelayMs        Timeout for the first-visit list.
 * @param {number}   options.everyLoadDelayMs         Timeout for the every-load list.
 * @param {string[]} options.hideSelectors            CSS selectors hidden until the
 *   first interaction (lastfold sections). Source: auditHideSelectors.
 * @returns {string} Obfuscated JavaScript.
 */
export function generateDeferredScript({
  interactionGatedScripts = [],
  firstVisitDelayedScripts = [],
  everyLoadDelayedScripts = [],
  firstVisitDelayMs = 12000,
  everyLoadDelayMs = 6000,
  hideSelectors = [],
} = {}) {
  const interactionGatedJson = JSON.stringify(interactionGatedScripts);
  const firstVisitDelayedJson = JSON.stringify(firstVisitDelayedScripts);
  const everyLoadDelayedJson = JSON.stringify(everyLoadDelayedScripts);
  const hideCssJson = JSON.stringify(buildHiddenCss(hideSelectors));

  // Source script template
  const rawScript = `
  (function () {
    "use strict";
    var doc = document;
    var docEl = document.documentElement;
    var classList = docEl.classList;
    var win = window;
    var startTime = performance.now();
    var hideCss = ${hideCssJson};
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

    var P = ${interactionGatedJson};

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

    doc.querySelectorAll("script").forEach(B);

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

      var FIRST_VISIT_DELAYED_SCRIPTS = ${firstVisitDelayedJson};
      var _delay = ${firstVisitDelayMs};
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
      var EVERY_LOAD_DELAYED_SCRIPTS = ${everyLoadDelayedJson};

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
      }, ${everyLoadDelayMs});
    })();
  })();
  `;

  // Server-side obfuscation. This file is a blocking <script> on every storefront
  // page, so size matters as much as strength. Measured on this template: the old
  // profile (control-flow flattening 1.0 + dead-code injection + rc4 + split
  // strings) produced ~197 KB (54 KB gzip) in ~660 ms; this one gives ~19 KB
  // (~7 KB gzip) in ~80 ms while still renaming identifiers, flattening part of
  // the control flow and moving strings into an encoded array.
  const obfuscatedResult = JavaScriptObfuscator.obfuscate(rawScript, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 0.3,
    deadCodeInjection: false,
    debugProtection: false,
    disableConsoleOutput: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    stringArrayEncoding: ["base64"],
    stringArrayThreshold: 0.75,
  });

  const obfuscated = obfuscatedResult.getObfuscatedCode();
  return TEMP_TIMING_LOG ? withTimingLog(obfuscated) : obfuscated;
}

// ---------------------------------------------------------------------------
// TEMPORARY — injection timing log. Set TEMP_TIMING_LOG to false (or delete
// this block and the `withTimingLog` call above) once you have the numbers,
// then rebuild the script (toggle the app off/on or save a Step 2 field).
//
// Kept OUTSIDE the obfuscated code on purpose: the obfuscator option
// `disableConsoleOutput` replaces console.log with a no-op for everything that
// runs after it, so the logger captures a bound console.log first.
// ---------------------------------------------------------------------------
const TEMP_TIMING_LOG = true;

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
