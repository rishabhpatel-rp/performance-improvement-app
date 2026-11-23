import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTokenForCrossRun } from "../app/lib/audit-candidates.ts";
import { buildPageRolesFromDiscovered } from "../app/lib/page-audit-roles.ts";
import { buildAuditReportSummary } from "../app/lib/audit-report-summary.server.ts";

/** Minimal completed audit fixture (T-3 invariants, no browser). */
const FIXTURE_REPORT = {
  deferArray: ["analytics.js", "pixel.js"],
  delayEveryArray: ["bat.js"],
  delayFirstArray: ["widgets/chat.js"],
  neverDefer: ["chunk.storefront.js"],
  hideSelectors: [],
  foldAssertion: { ok: true, violations: [], pagesChecked: 3 },
  funnel: [
    { request: 10, candidates: 8, emitted: 2 },
    { request: 12, candidates: 9, emitted: 2 },
  ],
  pagesAudited: ["/", "/collections/all", "/products/x"],
  completedAt: new Date().toISOString(),
  deferArrayByPage: { "/": ["analytics.js"] },
  deferArrayUnmerged: ["analytics.js", "pixel.js"],
  deferArrayBase: ["gtm"],
  deferArrayAddByPage: {},
  pagePatterns: { "/": ["/"] },
  selfExcluded: [],
  noiseDropped: [],
  foldReasons: {},
};

test("normalizeTokenForCrossRun strips build hashes across runs", () => {
  const a = normalizeTokenForCrossRun("app.a1b2c3d4.min.js");
  const b = normalizeTokenForCrossRun("app.e5f6g7h8.min.js");
  assert.equal(a, b);
});

test("buildPageRolesFromDiscovered maps home plp pdp", () => {
  const roles = buildPageRolesFromDiscovered(
    {
      home: "https://x.test/",
      plp: "https://x.test/collections/all",
      pdp: "https://x.test/products/hat",
    },
    ["/", "/collections/all", "/products/hat", "/pages/about"],
  );
  assert.equal(roles["/"], "home");
  assert.equal(roles["/collections/all"], "collection");
  assert.equal(roles["/products/hat"], "product");
  assert.equal(roles["/pages/about"], "extra");
});

test("T-3.1 fixture report defers at least one script", () => {
  assert.ok(FIXTURE_REPORT.deferArray.length > 0);
});

test("T-3.3 deferArray and neverDefer do not overlap", () => {
  const deferSet = new Set(FIXTURE_REPORT.deferArray);
  const overlap = FIXTURE_REPORT.neverDefer.filter((t) => deferSet.has(t));
  assert.equal(overlap.length, 0);
});

test("T-3.4 fold assertion passes on fixture", () => {
  assert.equal(FIXTURE_REPORT.foldAssertion.ok, true);
});

test("T-3.6 delay tiers present on fixture", () => {
  assert.ok(FIXTURE_REPORT.deferArray.length > 0);
  assert.ok((FIXTURE_REPORT.delayEveryArray ?? []).length > 0);
  assert.ok((FIXTURE_REPORT.delayFirstArray ?? []).length > 0);
});

test("T-3 summary builder preserves funnel totals", () => {
  const s = buildAuditReportSummary(FIXTURE_REPORT);
  assert.equal(s.funnelSteps.request, 22);
  assert.equal(s.funnelSteps.emitted, 4);
  assert.equal(s.foldAssertionOk, true);
});
