import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {
  buildRawScript,
  fingerprintRawScript,
  generateDeferredScript,
  obfuscateRawScript,
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

test("obfuscated output is safe to inline and within the inline capacity", () => {
  const out = obfuscateRawScript(buildRawScript(OPTIONS), { seed: 42 });
  assert.equal(isSafeForInline(out).ok, true);
  assert.ok(out.length < INLINE_CAPACITY_CHARS, "small-size profile stays under the inline capacity");
  assert.ok(out.includes("[PagePulse]"), "timing logger should be present while measuring load timings");
});

test("same input + same seed gives identical output; the seed changes it", () => {
  const raw = buildRawScript(OPTIONS);
  const a = obfuscateRawScript(raw, { seed: 7 });
  assert.equal(a, obfuscateRawScript(raw, { seed: 7 }));
  assert.notEqual(a, obfuscateRawScript(raw, { seed: 8 }));
});

test("generateDeferredScript equals build + obfuscate", () => {
  const raw = buildRawScript(OPTIONS);
  assert.equal(
    generateDeferredScript({ ...OPTIONS, seed: 5 }),
    obfuscateRawScript(raw, { seed: 5 }),
  );
});

test("fingerprint is stable for equal inputs and changes with any input", () => {
  const raw = buildRawScript(OPTIONS);
  const base = fingerprintRawScript(raw, { seed: 1 });
  assert.equal(base, fingerprintRawScript(buildRawScript(OPTIONS), { seed: 1 }));
  assert.notEqual(base, fingerprintRawScript(raw, { seed: 2 }));
  assert.notEqual(base, fingerprintRawScript(raw, { seed: 1, debugMode: true }));
  assert.notEqual(
    base,
    fingerprintRawScript(buildRawScript({ ...OPTIONS, everyLoadDelayMs: 1234 }), { seed: 1 }),
  );
  assert.notEqual(
    base,
    fingerprintRawScript(buildRawScript({ ...OPTIONS, baseScripts: ["other.js"] }), { seed: 1 }),
  );
});

test("timing logger is enabled for debugging and stays available in debug mode", () => {
  const raw = buildRawScript(OPTIONS);
  assert.ok(obfuscateRawScript(raw).includes("[PagePulse]"));
  assert.ok(obfuscateRawScript(raw, { debugMode: true }).includes("[PagePulse]"));
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
  return { ctx, classes, listeners, dispatched };
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

test("an un-audited page falls back to the union list", () => {
  const code = generateDeferredScript({ ...OPTIONS, seed: 9 });
  const { ctx } = makeBrowser("/blogs/news/hello");
  vm.runInContext(code, ctx);
  const plp = makeScript("https://cdn.example.com/plp-extra.js");
  ctx.Element.prototype.appendChild.call({}, plp);
  assert.equal(plp.type, "text/plain");
});
