import test from "node:test";
import assert from "node:assert/strict";
import { parsePsiLighthouse } from "../app/lib/psi.server.ts";

test("parsePsiLighthouse extracts category scores and audit metrics", () => {
  const parsed = parsePsiLighthouse({
    lighthouseResult: {
      categories: {
        performance: { score: 0.65 },
        accessibility: { score: 0.94 },
        "best-practices": { score: 0.92 },
        seo: { score: 0.92 },
      },
      audits: {
        "first-contentful-paint": { numericValue: 2900 },
        "largest-contentful-paint": { numericValue: 5600 },
        "total-blocking-time": { numericValue: 290 },
        "speed-index": { numericValue: 4900 },
        "cumulative-layout-shift": { numericValue: 0 },
      },
    },
  });
  assert.equal(parsed.categories?.performance, 65);
  assert.equal(parsed.categories?.accessibility, 94);
  assert.equal(parsed.metrics?.fcpSec, 2.9);
  assert.equal(parsed.metrics?.lcpSec, 5.6);
  assert.equal(parsed.metrics?.tbtMs, 290);
  assert.equal(parsed.metrics?.cls, 0);
});
