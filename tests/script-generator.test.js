import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  generateDeferredScript,
} from "../app/lib/script-generator.js";
import { INLINE_CAPACITY_CHARS, isSafeForInline } from "../app/lib/script-inline.js";

const OPTIONS = {
  baseScripts: ["base.js"],
  pageVariants: [{ pattern: "/products/", add: ["pdp-extra.js"], hide: ["#below-fold"] }],
  interactionGatedScripts: ["base.js", "pdp-extra.js", "plp-extra.js"],
  firstVisitDelayedScripts: ["chat-widget"],
  everyLoadDelayedScripts: ["analytics"],
  hideSelectors: ["#footer"],
};

test("generated output is safe to inline and within the inline capacity", () => {
  const out = generateDeferredScript(OPTIONS);
  assert.equal(isSafeForInline(out).ok, true);
  assert.ok(out.length < INLINE_CAPACITY_CHARS, "small-size profile stays under the inline capacity");
});

// c686cae replaced STOREFRONT_TIMING_LOG_ENABLED = false with a hardcoded
// `const TEMP_TIMING_LOG = true`, so the injection timing logger now ships on
// every build rather than only in debug mode. These tests assert that new
// contract. Set TEMP_TIMING_LOG back to false in app/lib/script-generator.js
// to drop the logger from production again.
test("timing logger ships on every build, debug mode or not", () => {
  const prod = generateDeferredScript(OPTIONS);
  const dbg = generateDeferredScript({ ...OPTIONS, debugMode: true });
  assert.ok(prod.includes("[PagePulse]"), "production builds ship the timing logger");
  assert.ok(dbg.includes("[PagePulse]"), "debug builds ship the timing logger");
});

// c686cae removed the seed: there is no obfuscation stage any more, so output is
// a pure function of its options. This test previously proved seed stability;
// it now proves determinism, which is the property the app actually relies on
// to decide whether a store's cached script is stale.
test("same options give byte-identical output; any change to options changes it", () => {
  const base = generateDeferredScript(OPTIONS);
  assert.equal(base, generateDeferredScript(OPTIONS));
  assert.notEqual(base, generateDeferredScript({ ...OPTIONS, baseScripts: ["other.js"] }));
  assert.notEqual(
    base,
    generateDeferredScript({
      ...OPTIONS,
      pageVariants: [{ pattern: "/collections/", add: ["plp-extra.js"], hide: [] }],
    }),
  );
  assert.notEqual(base, generateDeferredScript({ ...OPTIONS, everyLoadDelayMs: 1234 }));
  assert.notEqual(base, generateDeferredScript({ ...OPTIONS, hideSelectors: ["#other"] }));
});

// ---- smoke: the final bytes actually run and gate scripts -------------------
function makeBrowser(pathname) {
  const classes = new Set();
  const listeners = {};
  const timers = [];
  class Node {
    replaceChild() {}
  }
  class Element extends Node {
    setAttribute() {}
    appendChild() {}
    insertBefore() {}
  }
  class HTMLScriptElement extends Element {
    get src() { return ""; }
    set src(_v) {}
  }
  class MutationObserver {
    observe() {}
    disconnect() {}
  }
  class CustomEvent {
    constructor(type) { this.type = type; }
  }
  const docEl = { classList: {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
  } };
  const dispatched = [];
  const doc = {
    documentElement: docEl,
    head: { firstChild: null, appendChild() {}, insertBefore() {} },
    getElementById: () => null,
    createElement: () => ({ appendChild() {}, attributes: [], remove() {} }),
    createTextNode: () => ({}),
    addEventListener: () => {},
    dispatchEvent: (e) => dispatched.push(e.type),
    querySelectorAll: () => [],
  };
  const ctx = {
    document: doc,
    Node, Element, HTMLScriptElement, MutationObserver, CustomEvent,
    location: { pathname },
    performance: { now: () => 0 },
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    addEventListener: (evt, fn) => { (listeners[evt] ||= []).push(fn); },
    console: { log() {} },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  return { ctx, classes, listeners, dispatched, timers };
}

function makeScript(src) {
  return {
    tagName: "SCRIPT",
    src,
    type: "",
    getAttribute: () => null,
    hasAttribute: () => false,
    setAttribute() {},
    removeAttribute() {},
  };
}

test("bundle runs, parks a gated script on a matching page, and releases on interaction", () => {
  const code = generateDeferredScript({ ...OPTIONS, seed: 9 });
  const { ctx, classes, listeners } = makeBrowser("/products/gift-card");
  vm.runInContext(code, ctx);

  assert.ok(classes.has("f-interacted"), "first-visit class set before interaction");
  assert.ok(!classes.has("interacted"));

  // base.js is gated on every audited page; pdp-extra.js is added for /products/.
  const gated = makeScript("https://cdn.example.com/pdp-extra.js");
  ctx.Element.prototype.appendChild.call({}, gated);
  assert.equal(gated.type, "text/plain");
  assert.equal(gated._ps, "https://cdn.example.com/pdp-extra.js");

  const free = makeScript("https://cdn.example.com/unrelated.js");
  ctx.Element.prototype.appendChild.call({}, free);
  assert.equal(free.type, "");

  assert.ok(listeners.pointerdown?.length, "interaction listeners registered");
  listeners.pointerdown[0]();
  assert.ok(classes.has("interacted"));
});

test("empty delay lists do not arm delay timers", () => {
  const code = generateDeferredScript({
    ...OPTIONS,
    firstVisitDelayedScripts: [],
    everyLoadDelayedScripts: [],
    seed: 9,
  });
  const { ctx, timers } = makeBrowser("/products/gift-card");
  vm.runInContext(code, ctx);
  assert.equal(timers.length, 0);
});

test("an un-audited page falls back to the union list", () => {
  const code = generateDeferredScript({ ...OPTIONS, seed: 9 });
  const { ctx } = makeBrowser("/blogs/news/hello");
  vm.runInContext(code, ctx);
  const plp = makeScript("https://cdn.example.com/plp-extra.js");
  ctx.Element.prototype.appendChild.call({}, plp);
  assert.equal(plp.type, "text/plain");
});
