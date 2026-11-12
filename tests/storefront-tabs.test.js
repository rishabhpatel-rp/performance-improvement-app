import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildDeferredScriptSource } from "../app/lib/script-generator.js";
import { internalAuthOk, scriptsForScope, tabDropdownAction } from "../app/lib/scan-summary-scope.js";
import { readInternalSecret } from "../app/lib/internal-storefront-route.js";
import { applyScopePatch, toggleFamilyPatch } from "../app/lib/storefront-lists.ts";
import { templateScopedPageVariants } from "../app/lib/audit-template-buckets.ts";

test("home defers global plus home, and a product page does not defer the home-only name", () => {
  const code = buildDeferredScriptSource({
    tabScoped: true,
    baseScripts: ["g.js"],
    globalHideSelectors: [],
    globalFirstVisitDelayedScripts: [],
    globalEveryLoadDelayedScripts: [],
    firstVisitDelayedScripts: [],
    everyLoadDelayedScripts: [],
    interactionGatedScripts: ["g.js", "xyz.js"],
    hideSelectors: [],
    pageVariants: templateScopedPageVariants({
      defer: { global: ["g.js"], home: ["xyz.js"], collection: [], product: [] },
      hide: { global: [], home: [], collection: [], product: [] },
      first: { global: [], home: [], collection: [], product: [] },
      every: { global: [], home: [], collection: [], product: [] },
      firstMs: { home: 6000, collection: 6000, product: 10000 },
      everyMs: { home: 6000, collection: 6000, product: 10000 },
    }),
  });

  function gated(pathname, src) {
    const classes = new Set();
    const docEl = { classList: { add(c) { classes.add(c); }, remove() {}, contains: (c) => classes.has(c) } };
    const doc = {
      documentElement: docEl,
      head: { firstChild: null, appendChild() {}, insertBefore() {} },
      getElementById: () => null,
      createElement: () => ({ appendChild() {} }),
      createTextNode: () => ({}),
      addEventListener() {},
      dispatchEvent() {},
      querySelectorAll: () => [],
    };
    class Node { replaceChild() {} }
    class Element extends Node {
      setAttribute() {}
      appendChild() {}
      insertBefore() {}
    }
    class HTMLScriptElement extends Element {
      get src() { return ""; }
      set src(_v) {}
    }
    const ctx = {
      document: doc,
      Node, Element, HTMLScriptElement,
      MutationObserver: class { observe() {} disconnect() {} },
      CustomEvent: class { constructor(type) { this.type = type; } },
      location: { pathname },
      performance: { now: () => 0 },
      localStorage: { getItem: () => null, setItem() {} },
      setTimeout: () => 0,
      addEventListener() {},
      console: { log() {} },
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(code, ctx);
    const script = {
      tagName: "SCRIPT",
      src,
      type: "",
      getAttribute: () => null,
      hasAttribute: () => false,
      setAttribute() {},
      removeAttribute() {},
    };
    ctx.Element.prototype.appendChild.call({}, script);
    return script.type === "text/plain";
  }

  assert.equal(gated("/", "https://cdn.example.com/xyz.js"), true);
  assert.equal(gated("/", "https://cdn.example.com/g.js"), true);
  assert.equal(gated("/products/shirt", "https://cdn.example.com/xyz.js"), false);
  assert.equal(gated("/products/shirt", "https://cdn.example.com/g.js"), true);
  assert.match(code, /10000/);
  assert.match(code, /6000/);
});

test("a one-name product tab is kept on the variant list", () => {
  const variants = templateScopedPageVariants({
    defer: { global: [], home: [], collection: [], product: ["only.js"] },
    hide: { global: [], home: [], collection: [], product: [] },
    first: { global: [], home: [], collection: [], product: [] },
    every: { global: [], home: [], collection: [], product: [] },
    firstMs: { home: 1, collection: 1, product: 1 },
    everyMs: { home: 1, collection: 1, product: 1 },
  });
  assert.equal(variants.length, 3);
  assert.deepEqual(variants[0].add, ["only.js"]);
});

test("saving the home defer list does not change the product list", () => {
  const next = applyScopePatch(
    {
      auditDeferGlobal: ["g.js"],
      auditDeferHome: [],
      auditDeferCollection: [],
      auditDeferProduct: ["pdp.js"],
      auditHideGlobal: [],
      auditHideHome: [],
      auditHideCollection: [],
      auditHideProduct: [],
      firstUserDelayScriptsGlobal: [],
      firstUserDelayScriptsHome: [],
      firstUserDelayScriptsCollection: [],
      firstUserDelayScriptsProduct: [],
      staticDeferDefaultsGlobal: [],
      staticDeferDefaultsHome: [],
      staticDeferDefaultsCollection: [],
      staticDeferDefaultsProduct: [],
    },
    "home",
    { defer: ["xyz.js"] },
  );
  assert.deepEqual(next.auditDeferHome, ["xyz.js"]);
  assert.equal(next.auditDeferProduct, undefined);
  assert.ok(next.auditDeferArray.includes("xyz.js"));
  assert.ok(next.auditDeferArray.includes("pdp.js"));
  assert.ok(next.auditDeferArray.includes("g.js"));
});

test("keep-protected style clear on one tab leaves global in place", () => {
  const next = applyScopePatch(
    {
      auditDeferGlobal: ["g.js"],
      auditDeferHome: ["xyz.js"],
      auditDeferCollection: [],
      auditDeferProduct: [],
      auditHideGlobal: [],
      auditHideHome: [],
      auditHideCollection: [],
      auditHideProduct: [],
      firstUserDelayScriptsGlobal: [],
      firstUserDelayScriptsHome: [],
      firstUserDelayScriptsCollection: [],
      firstUserDelayScriptsProduct: [],
      staticDeferDefaultsGlobal: [],
      staticDeferDefaultsHome: [],
      staticDeferDefaultsCollection: [],
      staticDeferDefaultsProduct: [],
    },
    "home",
    { defer: [], first: [], every: [] },
  );
  assert.deepEqual(next.auditDeferHome, []);
  assert.ok(next.auditDeferArray.includes("g.js"));
  assert.equal(next.auditDeferArray.includes("xyz.js"), false);
});

test("turning defer off preserves the four scopes and clears them", () => {
  const row = {
    auditDeferGlobal: ["g.js"],
    auditDeferHome: ["xyz.js"],
    auditDeferCollection: [],
    auditDeferProduct: ["pdp.js"],
  };
  const off = toggleFamilyPatch(row, "defer", false);
  assert.equal(off.auditDeferArrayEnabled, false);
  assert.deepEqual(off.auditDeferHome, []);
  assert.deepEqual(off.auditDeferArrayPreserved, {
    global: ["g.js"],
    home: ["xyz.js"],
    collection: [],
    product: ["pdp.js"],
  });
  const on = toggleFamilyPatch({ ...row, ...off }, "defer", true);
  assert.deepEqual(on.auditDeferHome, ["xyz.js"]);
  assert.deepEqual(on.auditDeferProduct, ["pdp.js"]);
  assert.ok(on.auditDeferArray.includes("g.js"));
});

test("a global-only name stays Keep protected on the home dropdown", () => {
  assert.equal(
    tabDropdownAction({ auditDeferArray: [], firstUserDelayScripts: [], staticDeferDefaults: [] }, "g.js"),
    "protected",
  );
  assert.equal(
    tabDropdownAction({ auditDeferArray: ["xyz.js"], firstUserDelayScripts: [], staticDeferDefaults: [] }, "xyz.js"),
    "defer",
  );
});

test("the real save gate does not write when the secret is missing or the JSON is invalid", async () => {
  const { decideInternalStorefrontRequest } = await import(
    "../app/lib/internal-storefront-route.js"
  );
  let writes = 0;
  const refuseWrite = () => {
    writes += 1;
    throw new Error("database write");
  };

  const missingSecret = await decideInternalStorefrontRequest(
    new Request("http://app.test/api/internal/storefront-lists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        shopDomain: "example.myshopify.com",
        scope: "home",
        intent: "save-lists",
        patch: { defer: ["xyz.js"] },
      }),
    }),
    "",
  );
  assert.equal(missingSecret.status, 401);
  assert.equal(missingSecret.write, null);
  if (missingSecret.write) refuseWrite();

  const badJson = await decideInternalStorefrontRequest(
    new Request("http://app.test/api/internal/storefront-lists", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": "secret",
      },
      body: "{",
    }),
    "secret",
  );
  assert.equal(badJson.status, 400);
  assert.equal(badJson.body.error, "Invalid JSON");
  assert.equal(badJson.write, null);

  const badList = await decideInternalStorefrontRequest(
    new Request("http://app.test/api/internal/storefront-lists", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": "secret",
      },
      body: JSON.stringify({
        shopDomain: "example.myshopify.com",
        scope: "home",
        intent: "save-lists",
        patch: { defer: [1, "xyz.js"] },
      }),
    }),
    "secret",
  );
  assert.equal(badList.status, 400);
  assert.equal(badList.write, null);
  assert.equal(writes, 0);
});

test("a running server reads the secret from .env without a restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-secret-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "INTERNAL_API_SECRET=from-file\n");
  assert.equal(readInternalSecret({}, file), "from-file");
  assert.equal(readInternalSecret({ INTERNAL_API_SECRET: "from-process" }, file), "from-process");
  fs.rmSync(dir, { recursive: true });
});

test("a missing internal secret never authorizes", () => {
  assert.equal(internalAuthOk("anything", ""), false);
  assert.equal(internalAuthOk("anything", undefined), false);
  assert.equal(internalAuthOk("secret", "other"), false);
  assert.equal(internalAuthOk("secret", "secret"), true);
});

test("scan summary tabs keep a product-only script off the home tab", () => {
  const rows = [
    { token: "xyz.js", pages: ["/"] },
    { token: "pdp.js", pages: ["/products/shirt"] },
    { token: "both.js", pages: ["/", "/collections/all", "/products/shirt"] },
  ];
  const roles = { "/": "home", "/collections/all": "collection", "/products/shirt": "product" };
  assert.deepEqual(scriptsForScope(rows, roles, "home").map((r) => r.token), ["xyz.js", "both.js"]);
  assert.deepEqual(scriptsForScope(rows, roles, "product").map((r) => r.token), ["pdp.js", "both.js"]);
  assert.deepEqual(scriptsForScope(rows, roles, "global").map((r) => r.token), ["both.js"]);
});
