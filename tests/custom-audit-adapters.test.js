import { test } from "node:test";
import assert from "node:assert/strict";
import { auditDataToSummaryPayload } from "../app/lib/custom-audit-summary.ts";
import {
  buildReadableScriptForCustomAudit,
  scriptInputFromReport,
} from "../app/lib/custom-audit-script-input.ts";

const report = {
  deferArray: ["wpm"],
  delayEveryArray: ["gtm"],
  delayFirstArray: [],
  deferArrayByPage: { "/": ["wpm"], "/shop/all": ["wpm", "gtm"] },
  deferArrayUnmerged: ["wpm", "gtm"],
  deferArrayBase: ["wpm"],
  deferArrayAddByPage: {},
  hideSelectors: [".promo-banner"],
  hideSelectorsByPage: { "/": [".promo-banner"] },
  pagePatterns: {},
  neverDefer: [],
  selfExcluded: [],
  noiseDropped: [],
  foldReasons: {},
  funnel: [],
  foldAssertion: { ok: true, violations: [], pagesChecked: 2 },
  pagesAudited: ["/", "/shop/all"],
  completedAt: "2026-11-24T10:00:00.000Z",
  templateBuckets: {
    defer: { global: ["wpm"], home: [], collection: ["gtm"], product: [] },
    hide: { global: [], home: [], collection: [], product: [] },
  },
  pageRoles: { "/": "home", "/shop/all": "collection" },
};

const pages = {
  home: "https://example.com/",
  plp: "https://example.com/shop/all",
  pdp: "https://example.com/item/hat",
};

test("custom audit summary keeps page roles and top scripts for Step 2 table", () => {
  const summary = auditDataToSummaryPayload(report);
  assert.equal(summary.completedAt, report.completedAt);
  assert.deepEqual(summary.pageRoles, report.pageRoles);
  assert.equal(summary.foldAssertionOk, true);
  assert.ok(Array.isArray(summary.topScripts));
  assert.ok(summary.pages?.some((page) => page.path === "/"));
});

test("custom audit script input uses discovered generic page patterns", () => {
  const input = scriptInputFromReport(report, pages);
  assert.equal(input.tabScoped, true);
  assert.equal(input.baseScripts[0], "wpm");
  const patterns = input.pageVariants.map((variant) => variant.pattern);
  assert.ok(patterns.includes("/"));
  assert.ok(patterns.some((pattern) => pattern.startsWith("/shop/")));
  assert.ok(patterns.some((pattern) => pattern.startsWith("/item/")));
  assert.ok(!patterns.includes("/collections/"));
  assert.deepEqual(input.globalEveryLoadDelayedScripts, ["wpm", "gtm"]);
});

test("custom audit readable script contains the error monitor snippet", () => {
  const readable = buildReadableScriptForCustomAudit(report, pages);
  assert.ok(readable.length > 500);
  assert.match(readable, /\/apps\/performance-scripts\/api\/storefront-runtime-errors/);
  assert.match(readable, /\/shop\//);
});
