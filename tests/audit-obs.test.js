import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCandidateGate,
  collectTokensFromPass,
  setDiff,
  setsAreEqual,
  summarizeGateFunnel,
  summarizeSafetyNet,
} from "../app/lib/audit-obs.ts";

test("setsAreEqual and setDiff", () => {
  const a = new Set(["x", "y"]);
  const b = new Set(["y", "x"]);
  const c = new Set(["y", "z"]);
  assert.equal(setsAreEqual(a, b), true);
  assert.equal(setsAreEqual(a, c), false);
  assert.deepEqual(setDiff(a, c).sort(), ["x"]);
});

test("collectTokensFromPass slices by pass index", () => {
  const pages = [
    { acc: { p: ["a", "b"] } },
    { acc: { p: ["c"] } },
    { acc: { p: ["a", "d"] } },
    { acc: { p: ["c"] } },
  ];
  const p0 = collectTokensFromPass(pages, 2, 0);
  const p1 = collectTokensFromPass(pages, 2, 1);
  assert.deepEqual([...p0].sort(), ["a", "b", "c"]);
  assert.deepEqual([...p1].sort(), ["a", "c", "d"]);
  assert.equal(setsAreEqual(p0, p1), false);
});

test("summarizeSafetyNet rates hits", () => {
  const s = summarizeSafetyNet([
    { settle: { hitSafetyNet: true } },
    { settle: { hitSafetyNet: false } },
    { settle: { hitSafetyNet: true } },
  ]);
  assert.equal(s.hits, 2);
  assert.equal(s.total, 3);
  assert.ok(Math.abs(s.rate - 2 / 3) < 1e-9);
});

test("classifyCandidateGate marks commented 4-C for assets/", () => {
  const r = classifyCandidateGate("assets/theme.js");
  assert.equal(r.classification, "kept");
  assert.equal(r.gate, "gate-4c-assets");
  assert.equal(r.commentedGateWouldBlock, true);
});

test("classifyCandidateGate still never-defers storefront", () => {
  const r = classifyCandidateGate("storefront/standard-actions.js");
  assert.equal(r.classification, "never-defer");
  assert.equal(r.commentedGateWouldBlock, false);
});

test("summarizeGateFunnel counts would-be 4-C blocks", () => {
  const { wouldGate4C, byGate } = summarizeGateFunnel([
    "assets/main.js",
    "files/app.js",
    "storefront/x.js",
  ]);
  assert.equal(wouldGate4C, 1);
  assert.equal(byGate["gate-4c-assets"], 1);
  assert.equal(byGate["never-path-substring"] + byGate["never-stem-prefix-cmp"], 1);
});
