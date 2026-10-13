import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditReportSummary } from "../app/lib/audit-report-summary.server.ts";

const baseReport = {
  deferArray: ["clarity"],
  hideSelectors: [],
  popupSelectors: [],
  pagesAudited: ["/", "/collections/all"],
  completedAt: "2026-10-12T12:00:00.000Z",
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
      settle: {
        lastScriptResponseEnd: 0,
        postInteractionDelta: 0,
        scrollSteps: 0,
        clicks: 0,
        hitSafetyNet: false,
      },
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
  scriptInventory: {
    byToken: [
      {
        token: "clarity",
        status: "deferred",
        reasons: ["emitted-defer"],
        bytes: 2048,
        pages: ["/"],
      },
    ],
    totals: {
      scriptRequests: 10,
      thirdPartyBytes: 2048,
      deferredTokenCount: 1,
      protectedTokenCount: 0,
    },
  },
};

test("golden AuditReportSummary shape (dates normalized)", () => {
  const s = buildAuditReportSummary(baseReport);
  const golden = {
    pages: s.pages,
    foldAssertionOk: s.foldAssertionOk,
    stats: s.stats,
    topScripts: s.topScripts.map((r) => ({
      token: r.token,
      status: r.status,
      kb: r.kb,
    })),
    funnelSteps: s.funnelSteps,
  };
  assert.deepEqual(golden, {
    pages: [
      { label: "Home", path: "/" },
      { label: "/collections/all", path: "/collections/all" },
    ],
    foldAssertionOk: true,
    stats: {
      scriptsSeen: 10,
      deferred: 1,
      protected: 0,
      hiddenSelectors: 0,
      popups: 0,
    },
    topScripts: [{ token: "clarity", status: "deferred", kb: 2 }],
    funnelSteps: { request: 10, candidates: 8, emitted: 2 },
  });
});
