/**
 * Serves the audit script from the backend
 * Accessible at: /apps/audit-script (app proxy)
 *
 * This endpoint returns the audit script as JavaScript, allowing you to:
 * - Serve it dynamically from your backend
 * - Update the script without redeploying the theme extension
 * - Track script delivery and usage
 */

import { authenticate } from "../shopify.server";

const AUDIT_SCRIPT = `/* 1. Audit script - Served from Node.js Backend */
! function() {
    'use strict';
    var PAGES = [
        'https://rishabh-appdev-store.myshopify.com/',
        'https://rishabh-appdev-store.myshopify.com/collections/all'
    ];

    var WAIT_MS = 40000,
        SIZE = 80,
        STORE_KEY = 'shopAuditState_v1',
        P_KEY = 'shopAuditP_v1',
        VIS_KEY = 'shopAuditVisible_v1',
        OFF_KEY = 'shopAuditOff_v1';
    var EXCLUDED_HOSTS = {};
    EXCLUDED_HOSTS[location.hostname] = 1;
    EXCLUDED_HOSTS['cdn.shopify.com'] = 1;
    EXCLUDED_HOSTS['shop.app'] = 1;
    EXCLUDED_HOSTS['checkout.shopify.com'] = 1;
    EXCLUDED_HOSTS['cdn.shopifycloud.com'] = 1;
    var EXCLUDED_KEYWORDS = ['www.', 'storefront', 'chunk'];

    function esc(s) {
        return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^a-zA-Z0-9_-]/g, '\\\\$&');
    }

    function isThirdPartyHost(h) {
        try {
            var x = String(h).toLowerCase();
            if (!x) return !1;
            if (EXCLUDED_HOSTS[x]) return !1;
            if (x.endsWith('.' + location.hostname)) return !1;
            return !0;
        } catch (_) {
            return !1;
        }
    }

    function passesPFilter(s) {
        var a = String(s).toLowerCase(),
            b = a.replace(/\\.js$/i, ''),
            c = (b.match(/\\d/g) || []).length;
        if (/^\\d+$/.test(b) || c > 5) return !1;
        if (EXCLUDED_KEYWORDS.some(function(k) { return a.indexOf(k) !== -1; })) return !1;
        return !0;
    }

    function isDynamicToken(t) {
        var s = String(t).toLowerCase();
        if (!s) return !0;
        if (/^\\d+$/.test(s)) return !0;
        if ((s.match(/\\d/g) || []).length > 5) return !0;
        if (/^[a-f0-9]{8,}$/i.test(s)) return !0;
        if (s.indexOf('shopify-') !== -1 || s.indexOf('section-') !== -1 || s.indexOf('block-') !== -1) return !0;
        if (s.length > 40) return !0;
        if (/[a-z0-9]{20,}/i.test(s)) return !0;
        return !1;
    }

    function isMajor(el) {
        if (el.nodeType !== 1) return !1;
        var tag = el.tagName.toLowerCase();
        if (['html', 'body', 'head', 'script', 'style', 'link', 'meta', 'noscript', 'template', 'svg', 'path', 'br', 'hr'].indexOf(tag) !== -1) return !1;
        if (!el.className && !el.id) return !1;
        var cs = getComputedStyle(el);
        if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return !1;
        var r = el.getBoundingClientRect();
        if (r.width < SIZE && r.height < SIZE) return !1;
        return !0;
    }

    function isVisible(el) {
        var r = el.getBoundingClientRect();
        return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    }

    function getStableSelectors(el) {
        var out = [];
        if (el.id && !isDynamicToken(el.id)) out.push('#' + esc(el.id));
        var classes = Array.prototype.filter.call(el.classList, function(c) {
            return !isDynamicToken(c);
        });
        if (classes.length) out.push('.' + classes.slice(0, 4).map(esc).join('.'));
        return out;
    }

    function auditP() {
        var srcSet = {};
        document.querySelectorAll('script[src]').forEach(function(s) {
            var src = s.getAttribute('src') || s.src;
            if (src) srcSet[src] = 1;
        });
        try {
            performance.getEntriesByType('resource').forEach(function(e) {
                if (e.initiatorType === 'script' || /\\.js(\\?|$)/i.test(e.name)) srcSet[e.name] = 1;
            });
        } catch (_) {}
        var candidates = {};
        Object.keys(srcSet).forEach(function(src) {
            try {
                var u = new URL(src, location.href);
                if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
                u.hash = '';
                u.search = '';
                var p = u.pathname.split('/').filter(Boolean),
                    b = p.pop();
                if (b) candidates[decodeURIComponent(b)] = 1;
                var h = u.hostname.toLowerCase();
                if (isThirdPartyHost(h)) candidates[h] = 1;
            } catch (_) {}
        });
        var res = [];
        Object.keys(candidates).forEach(function(c) {
            var x = String(c).trim();
            if (x && passesPFilter(x)) res.push(x);
        });
        return res;
    }

    function auditSelectors() {
        var all = Array.prototype.filter.call(document.querySelectorAll('*'), isMajor),
            visEls = [],
            offEls = [];
        all.forEach(function(el) {
            if (isVisible(el)) visEls.push(el);
            else offEls.push(el);
        });
        var visible = {},
            off = {};

        function record(sel, isVis) {
            if (isVis) visible[sel] = 1;
            else off[sel] = 1;
        }
        var structuralMatched = new Set();
        all.forEach(function(container) {
            if (!container.children || container.children.length < 4) return;
            var containerSels = getStableSelectors(container);
            if (!containerSels.length) return;
            var children = Array.prototype.slice.call(container.children);
            var start = -1;
            for (var i = 3; i < children.length; i++) {
                if (offEls.indexOf(children[i]) !== -1) {
                    start = i;
                    break;
                }
            }
            if (start === -1) return;
            var allOff = true;
            for (var j = start; j < children.length; j++) {
                if (offEls.indexOf(children[j]) === -1) {
                    allOff = false;
                    break;
                }
            }
            if (!allOff) return;
            var sel = containerSels[0] + ' > :nth-child(n+' + (start + 1) + ')';
            var matching = document.querySelectorAll(sel);
            var anyVis = false;
            matching.forEach(function(m) {
                if (visEls.indexOf(m) !== -1) anyVis = true;
            });
            if (anyVis) return;
            record(sel, false);
            matching.forEach(function(m) {
                structuralMatched.add(m);
            });
        });
        offEls.forEach(function(el) {
            if (structuralMatched.has(el)) return;
            var sels = getStableSelectors(el);
            if (sels.length) {
                sels.forEach(function(s) {
                    record(s, false);
                });
                return;
            }
            var anc = el.parentElement;
            while (anc && anc !== document.body) {
                var ancSels = getStableSelectors(anc);
                if (ancSels.length && offEls.indexOf(anc) !== -1) {
                    ancSels.forEach(function(s) {
                        record(s, false);
                    });
                    break;
                }
                anc = anc.parentElement;
            }
        });
        return { visible: visible, off: off };
    }

    function loadJSON(k, f) {
        try {
            return JSON.parse(localStorage.getItem(k)) || f;
        } catch (_) {
            return f;
        }
    }

    function saveJSON(k, v) {
        localStorage.setItem(k, JSON.stringify(v));
    }

    function wait(ms) {
        return new Promise(function(r) { setTimeout(r, ms); });
    }

    // Function to communicate audit results to your Node.js API endpoint
    function sendAuditToNodeServer(finalP, finalSelectors) {
        fetch('/apps/my-first-custom-app', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                domain: location.hostname,
                pScripts: finalP,
                offScreenSelectors: finalSelectors
            })
        })
        .then(function(res) {
            if (!res.ok) {
                throw new Error('HTTP ' + res.status + ' - Check terminal server logs');
            }
            return res.json();
        })
        .then(function(data) {
            console.log('%c[Node Sync Success]:', 'color:#00e676', data);
        })
        .catch(function(err) {
            console.error('[Node Sync Error]:', err);
        });
    }

    function outputFinal() {
  console.log('%c[Shopify Audit] Audit completed for all pages.', 'color:#00e676;font-weight:bold');
        var Pset = {};
        loadJSON(P_KEY, []).forEach(function(x) { Pset[x] = 1; });
        var visSet = {};
        loadJSON(VIS_KEY, []).forEach(function(x) { visSet[x] = 1; });
        var offSet = {};
        loadJSON(OFF_KEY, []).forEach(function(x) { offSet[x] = 1; });
        var finalP = Object.keys(Pset).sort();
        var finalSelectors = Object.keys(offSet).filter(function(s) { return !visSet[s]; }).sort();

        console.log('%c[Shopify Audit] Final P scripts:', 'color:#00e676', finalP);
        console.log('%c[Shopify Audit] Final offscreen selectors:', 'color:#00e676', finalSelectors);

        sendAuditToNodeServer(finalP, finalSelectors);
    }

    async function run() {
        console.log('%c[Shopify Audit] Starting audit script on page:', 'color:#00e676', location.href);
        var state = loadJSON(STORE_KEY, { currentIndex: 0 });
        if (typeof state.currentIndex !== 'number') state.currentIndex = 0;
        console.log('%c[Shopify Audit1] Completed page:', 'color:#00e676', state.currentIndex);
        console.log('%c[Shopify Audit2] Found P scripts:', 'color:#00e676', PAGES.length);
        if (state.currentIndex >= PAGES.length) {
            outputFinal();
            return;
        }
        console.log('%c[Audit] Page ' + (state.currentIndex + 1) + '/' + PAGES.length + ': ' + location.href, 'color:#ff8f00;font-weight:bold');
        console.log('[Audit] Waiting ' + WAIT_MS / 1000 + 's...');

        await wait(WAIT_MS);
        var p = auditP(), sel = auditSelectors();
        var Pset = {}, visSet = {}, offSet = {};
        loadJSON(P_KEY, []).forEach(function(x) { Pset[x] = 1; });
        loadJSON(VIS_KEY, []).forEach(function(x) { visSet[x] = 1; });
        loadJSON(OFF_KEY, []).forEach(function(x) { offSet[x] = 1; });
        p.forEach(function(x) { Pset[x] = 1; });
        Object.keys(sel.visible).forEach(function(k) { visSet[k] = 1; });
        Object.keys(sel.off).forEach(function(k) { offSet[k] = 1; });
        saveJSON(P_KEY, Object.keys(Pset));
        saveJSON(VIS_KEY, Object.keys(visSet));
        saveJSON(OFF_KEY, Object.keys(offSet));
        state.currentIndex++;
        saveJSON(STORE_KEY, state);
        console.log('%c[Shopify Audit] Completed page:', 'color:#00e676', state.currentIndex);
        console.log('%c[Shopify Audit] Found P scripts:', 'color:#00e676', PAGES.length);
        if (state.currentIndex < PAGES.length) {
            console.log('%c[Shopify Audit] Navigating to next page:', 'color:#00e676', PAGES[state.currentIndex]);
            location.href = PAGES[state.currentIndex];
        } else outputFinal();
    }
    if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', run);
    else run();
}();`;

export async function loader({ request }) {
  try {
    //Authenticate as public app proxy
    const auth = await authenticate.public.appProxy(request);
    console.log("[Audit Script] Authentication successful:", auth);

    if (!auth) {
      console.error("[Audit Script] Authentication failed");
      return new Response(
        `console.error("[Audit Script] Authentication failed");`,
        {
          status: 401,
          headers: { "Content-Type": "application/javascript" },
        }
      );
    }

    console.log("[Audit Script] Script requested from:", request.headers.get("referer"));

    // Return JavaScript with proper content-type
    return new Response(AUDIT_SCRIPT, {
      status: 200,
      headers: {
        "Content-Type": "application/javascript; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    });
  } catch (error) {
    console.error("[Audit Script Error]:", error);
    console.error("[Audit Script Error]:", error.message);

    // Return error as JavaScript for debugging
    return new Response(
      `console.error("[Audit Script Error]:", "${error.message}");`,
      {
        status: 500,
        headers: { "Content-Type": "application/javascript; charset=utf-8" },
      }
    );
  }
}
