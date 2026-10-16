import test from "node:test";
import assert from "node:assert/strict";
import { buildAuditReportSummary } from "../app/lib/audit-report-summary.server.ts";

test("topScripts includes home request order and timeline from inventory", () => {
  const report = {
    deferArray: [],
    hideSelectors: [],
    popupSelectors: [],
    pagesAudited: ["/"],
    completedAt: "2026-10-12T00:00:00.000Z",
    foldAssertion: { ok: true, violations: [], pagesChecked: 1 },
    funnel: [],
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
          token: "tag/abc",
          status: "protected",
          reasons: ["not-emitted"],
          pages: ["/"],
          bytes: 2048,
          durationMs: 12,
          homeRequestOrder: 1,
          homeStartMs: 55.2,
        },
      ],
      totals: {
        scriptRequests: 1,
        thirdPartyBytes: 2048,
        deferredTokenCount: 0,
        protectedTokenCount: 1,
      },
    },
  };
  const s = buildAuditReportSummary(report);
  assert.equal(s.topScripts.length, 1);
  assert.equal(s.topScripts[0].homeRequestOrder, 1);
  assert.equal(s.topScripts[0].homeStartMs, 55.2);
});

test("topScripts lists classified tokens when the audit stored no inventory", () => {
  const report = {
    deferArray: ["clarity"],
    neverDefer: ["jquery"],
    noiseDropped: ["pixel"],
    selfExcluded: [],
    foldReasons: {},
    deferArrayByPage: { "/": ["clarity"] },
    hideSelectors: [],
    popupSelectors: [],
    pagesAudited: ["/"],
    completedAt: "2026-10-16T00:00:00.000Z",
    foldAssertion: { ok: true, violations: [], pagesChecked: 1 },
    funnel: [],
  };
  const s = buildAuditReportSummary(report);
  const byToken = Object.fromEntries(s.topScripts.map((r) => [r.token, r.status]));
  assert.deepEqual(byToken, {
    clarity: "deferred",
    jquery: "never",
    pixel: "noise",
  });
  assert.deepEqual(s.topScripts.find((r) => r.token === "clarity").pages, ["/"]);
});
