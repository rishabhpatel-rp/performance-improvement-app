import test from "node:test";
import assert from "node:assert/strict";
import {
  applyScopedTokenAction,
  buildArrayPatchForTokenAction,
  effectiveListForScope,
  inferScriptActionFromLists,
} from "../app/lib/audit-script-actions-pure.ts";
import {
  auditDeferColumn,
  readBucketsFromRow,
} from "../app/lib/template-script-config.ts";

const base = {
  auditDeferArray: ["a.js"],
  firstUserDelayScripts: ["wpm"],
  staticDeferDefaults: ["gtm"],
};

test("buildArrayPatchForTokenAction adds defer and removes from delay lists", () => {
  const patch = buildArrayPatchForTokenAction(base, "clarity", "defer");
  assert.deepEqual(patch?.auditDeferArray?.sort(), ["a.js", "clarity"]);
  assert.ok(!patch?.firstUserDelayScripts?.includes("clarity"));
  assert.ok(!patch?.staticDeferDefaults?.includes("clarity"));
});

test("buildArrayPatchForTokenAction delay_first moves token", () => {
  const patch = buildArrayPatchForTokenAction(base, "a.js", "delay_first");
  assert.ok(!patch?.auditDeferArray?.includes("a.js"));
  assert.ok(patch?.firstUserDelayScripts?.includes("a.js"));
});

test("inferScriptActionFromLists reads defer list", () => {
  assert.equal(
    inferScriptActionFromLists(base, "a.js", "protected"),
    "defer",
  );
});

test("applyScopedTokenAction updates only the chosen scope column", () => {
  const defer = { global: [], home: [], collection: [], product: [] };
  const first = { global: ["wpm"], home: [], collection: [], product: [] };
  const every = { global: [], home: [], collection: [], product: [] };
  const out = applyScopedTokenAction(defer, first, every, "home", "clarity", "defer");
  assert.deepEqual(out?.defer.home, ["clarity"]);
  assert.deepEqual(out?.defer.global, []);
});

test("effectiveListForScope unions global with template scope", () => {
  const row = {
    auditDeferGlobal: ["g"],
    auditDeferHome: ["h"],
    auditDeferCollection: [],
    auditDeferProduct: [],
    firstUserDelayScriptsGlobal: [],
    firstUserDelayScriptsHome: [],
    firstUserDelayScriptsCollection: [],
    firstUserDelayScriptsProduct: [],
    staticDeferDefaultsGlobal: [],
    staticDeferDefaultsHome: [],
    staticDeferDefaultsCollection: [],
    staticDeferDefaultsProduct: [],
  };
  const defer = readBucketsFromRow(row, auditDeferColumn, "auditDeferArray");
  assert.deepEqual(effectiveListForScope(defer, "home"), ["g", "h"]);
});
