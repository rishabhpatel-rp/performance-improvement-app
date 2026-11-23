import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  configFromDbRow,
  emptyAuditStatus,
  DEFAULT_CONFIG,
  STORE_CONFIG_SELECT,
} from "../app/lib/dashboard-loader-core.ts";
import { resolveStoreIdForCache } from "../app/lib/dashboard-endpoint-cache.server.ts";

test("loader: configFromDbRow returns null when no StoreConfig row", () => {
  assert.equal(configFromDbRow(null), null);
  assert.equal(configFromDbRow(undefined), null);
});

test("loader: configFromDbRow parses JSON-ish arrays safely", () => {
  const row = {
    appEnabled: true,
    script1Enabled: false,
    script2Enabled: true,
    script3Enabled: false,
    debugMode: true,
    scriptTitles: ["a", "b"],
    auditComplete: true,
    auditDeferArray: ["x"],
    auditHideSelectors: null,
    staticDeferDefaults: ["wpm", "gtm"],
  };
  const cfg = configFromDbRow(row);
  assert.equal(cfg.appEnabled, true);
  assert.deepEqual(cfg.scriptTitles, ["a", "b"]);
  assert.deepEqual(cfg.auditDeferArray, ["x"]);
  assert.deepEqual(cfg.auditHideSelectors, []);
  assert.deepEqual(cfg.staticDeferDefaults, ["wpm", "gtm"]);
});

test("loader: emptyAuditStatus has no progress and no error", () => {
  const s = emptyAuditStatus();
  assert.equal(s.running, false);
  assert.equal(s.complete, false);
  assert.equal(s.failed, false);
  assert.equal(s.progress, 0);
});

test("loader: config defaults are centralized", () => {
  assert.deepEqual(DEFAULT_CONFIG.firstUserDelayScripts, ["wpm", "gtm"]);
  assert.equal(DEFAULT_CONFIG.firstUserDelayMs, 12000);
  assert.equal(DEFAULT_CONFIG.everyTimeDelayMs, 6000);
  assert.ok(STORE_CONFIG_SELECT.firstUserDelayMs);
  assert.equal(STORE_CONFIG_SELECT.onboardingActivated, true);
});

test("loader: new store resolves its id from the upsert result", () => {
  assert.equal(resolveStoreIdForCache(null, { id: "new" }), "new");
});

test("loader: reads the Store row once and derives the queue snapshot from the resolved id", () => {
  const src = fs.readFileSync(new URL("../app/routes/app._index.jsx", import.meta.url), "utf8");
  assert.match(src, /getShopQueueSnapshot\(\s*persistedStoreId,/);
  assert.doesNotMatch(src, /getShopQueueSnapshot\(\s*store\.id/);
});

import {
  needsShopifyRefresh,
  buildAuditStatus,
  buildFinalConfig,
  readAuditPages,
} from "../app/lib/dashboard-loader.server.ts";

test("P1-2: fast path gates move into the loader helper", () => {
  const now = 1_000_000_000_000;
  assert.equal(needsShopifyRefresh(null, "/app", "/audit-submit", null, now), true);
  assert.equal(needsShopifyRefresh({ isActive: false }, "/app", "/audit-submit", null, now), true);
  assert.equal(needsShopifyRefresh({ isActive: true }, "/app", "/audit-submit", null, now), false);
  assert.equal(
    needsShopifyRefresh({ isActive: true }, "/app?refresh=1", "/audit-submit", null, now),
    true,
  );
  assert.equal(
    needsShopifyRefresh(
      { isActive: true },
      "/app",
      "/audit-submit",
      "https://old/audit-submit",
      now,
    ),
    true,
  );
  assert.equal(
    needsShopifyRefresh(
      { isActive: true, lastSyncedAt: new Date(now - 11 * 60_000) },
      "/app",
      "/audit-submit",
      null,
      now,
    ),
    true,
  );
});

test("P1-2: audit status is assembled with truthful progress", () => {
  const status = buildAuditStatus(
    { auditRunning: true, auditPageIndex: 2, auditTotalPages: 4, auditPhase: "auditing" },
    null,
  );
  assert.equal(status.progress, 50);
  assert.equal(status.running, true);
  assert.equal(status.phase, "auditing");
  assert.deepEqual(buildAuditStatus(null, null).pages, []);
});

test("P1-2: final config keeps audit-empty arrays and schema defaults", () => {
  const cfg = buildFinalConfig(
    { auditDeferArray: ["stale"] },
    { lastAuditAt: new Date(), auditDeferArray: [] },
    {},
  );
  assert.deepEqual(cfg.auditDeferArray, []);
  const fresh = buildFinalConfig({}, {}, {});
  assert.deepEqual(fresh.firstUserDelayScripts, ["wpm", "gtm"]);
  assert.equal(fresh.firstUserDelayMs, 12000);
});

test("P1-2: malformed audit page rows are ignored", () => {
  assert.deepEqual(readAuditPages([{ label: "Home", path: "/" }, { nope: 1 }]), [
    { label: "Home", path: "/" },
  ]);
});

import {
  dashboardReducer,
  deriveAuditState,
  deriveMaxStep,
} from "../app/lib/audit-state-machine.ts";

test("CQ-7: state machine walks idle → queued → discovering → running → complete", () => {
  let state = { audit: "idle", currentStep: 1 };
  state = dashboardReducer(state, { type: "AUDIT_STARTED" });
  assert.equal(state.audit, "queued");
  state = dashboardReducer(state, { type: "PHASE", phase: "discovering" });
  assert.equal(state.audit, "discovering");
  state = dashboardReducer(state, { type: "PHASE", phase: "auditing" });
  assert.equal(state.audit, "running");
  state = dashboardReducer(state, { type: "AUDIT_COMPLETE" });
  assert.equal(state.audit, "complete");
  assert.equal(state.currentStep, 2);
});

test("CQ-7: failure keeps the merchant on step 1", () => {
  const state = dashboardReducer({ audit: "running", currentStep: 1 }, { type: "AUDIT_FAILED" });
  assert.equal(state.audit, "failed");
  assert.equal(state.currentStep, 1);
});

test("CQ-7: step 2 unlocks only on a completed audit with the embed on", () => {
  assert.equal(deriveMaxStep("complete", true, false), 2);
  assert.equal(deriveMaxStep("running", true, false), 1);
  assert.equal(deriveMaxStep("complete", true, true), 1);
  assert.equal(deriveMaxStep("complete", false, false), 1);
});

test("CQ-7: audit state is derived from a single input object", () => {
  assert.equal(deriveAuditState({ expectingAudit: true, phase: "queued" }), "queued");
  assert.equal(deriveAuditState({ complete: true, running: false }), "complete");
  assert.equal(deriveAuditState({ failed: true }), "failed");
  assert.equal(deriveAuditState({}), "idle");
});

test("P1-2: the loader reads the Store row exactly once", () => {
  const src = fs.readFileSync(new URL("../app/routes/app._index.jsx", import.meta.url), "utf8");
  const calls = src.match(/prisma\.store\.findUnique\(/g) || [];
  assert.equal(calls.length, 1, `expected one Store query, found ${calls.length}`);
});
