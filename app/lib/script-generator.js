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

export function generateDeferredScript(
  auditArray,
  deferArray,
  {
    firstUserDelayScripts = ["anime.js"],
    firstUserDelayMs = 12000,
    everyTimeDelayMs = 6000,
    hideSelectors = [],
  } = {}
) {
  const auditJson = JSON.stringify(auditArray);
  const deferJson = JSON.stringify(deferArray);
  const firstUserJson = JSON.stringify(firstUserDelayScripts);
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

    var P = ${auditJson};

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

      var FIRST_USER_DELAY_SCRIPTS = ${firstUserJson};
      var _delay = ${firstUserDelayMs};
      var fudRe = FIRST_USER_DELAY_SCRIPTS.length
        ? new RegExp(
            FIRST_USER_DELAY_SCRIPTS.map(function (p) {
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
      var EVERY_TIME_DELAY_SCRIPTS = ${deferJson};

      var etRe = EVERY_TIME_DELAY_SCRIPTS.length
        ? new RegExp(
            EVERY_TIME_DELAY_SCRIPTS.map(function (p) {
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
      }, ${everyTimeDelayMs});
    })();
  })();
  `;

  // Server-side JavaScript obfuscation — maximum strength (new Function() safe)
  const obfuscatedResult = JavaScriptObfuscator.obfuscate(rawScript, {
    compact: true,
    controlFlowFlattening: true,
    controlFlowFlatteningThreshold: 1,
    deadCodeInjection: true,
    deadCodeInjectionThreshold: 1,
    debugProtection: false,
    debugProtectionInterval: 0,
    disableConsoleOutput: true,
    identifierNamesGenerator: "hexadecimal",
    renameGlobals: false,
    selfDefending: false,
    stringArray: true,
    stringArrayCallsTransform: true,
    stringArrayEncoding: ["rc4", "base64"],
    stringArrayThreshold: 1,
    splitStrings: true,
    splitStringsChunkLength: 3,
    transformObjectKeys: true,
    unicodeEscapeSequence: true,
  });

  return obfuscatedResult.getObfuscatedCode();
}
