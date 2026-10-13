import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditReportSummary } from "../app/lib/audit-report-summary.server.ts";

const baseReport = {
  deferArray: ["clarity"],
  hideSelectors: ["#x"],
  popupSelectors: [".popup"],
  pagesAudited: ["/", "/collections/a"],
  completedAt: "2026-10-12T00:00:00.000Z",
  foldAssertion: { ok: true, violations: [], pagesChecked: 2 },
  funnel: [
    {
      request: 10,
      candidates: 8,
      emitted: 2,
      dom: 0,
      resourceTiming: 0,
      requestOnly: 0,
      disagreement: 0,
      neverDefer: 0,
      noise: 0,
      selfExcluded: 0,
      foldProtected: 0,
      coverageRan: 0,
      coverageUnknown: 0,
      settle: { lastScriptResponseEnd: 0, postInteractionDelta: 0, scrollSteps: 0, clicks: 0, hitSafetyNet: false },
    },
    {
      request: 12,
      candidates: 9,
      emitted: 3,
      dom: 0,
      resourceTiming: 0,
      requestOnly: 0,
      disagreement: 0,
      neverDefer: 0,
      noise: 0,
      selfExcluded: 0,
      foldProtected: 0,
      coverageRan: 0,
      coverageUnknown: 0,
      settle: { lastScriptResponseEnd: 0, postInteractionDelta: 0, scrollSteps: 0, clicks: 0, hitSafetyNet: false },
    },
  ],
  deferArrayByPage: {},
  deferArrayUnmerged: [],
  deferArrayBase: [],
  deferArrayAddByPage: {},
  hideSelectorsByPage: {},
  popupSelectorsByPage: {},
  pagePatterns: {},
  neverDefer: [],
  selfExcluded: [],
  noiseDropped: [],
  foldReasons: {},
};

test("buildAuditReportSummary aggregates funnel and stats", () => {
  const s = buildAuditReportSummary(baseReport);
  assert.equal(s.stats.deferred, 1);
  assert.equal(s.stats.hiddenSelectors, 1);
  assert.equal(s.stats.popups, 1);
  assert.equal(s.funnelSteps.request, 22);
  assert.equal(s.funnelSteps.emitted, 5);
  assert.equal(s.foldAssertionOk, true);
  assert.equal(s.staleScanWarning, false);
});

test("buildAuditReportSummary marks scans older than 30 days", () => {
  const old = {
    ...baseReport,
    completedAt: "2020-01-01T00:00:00.000Z",
  };
  const s = buildAuditReportSummary(old);
  assert.equal(s.staleScanWarning, true);
});
