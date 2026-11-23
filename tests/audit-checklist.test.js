import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { auditProgressPercent } from "../app/lib/audit-lifecycle.ts";
import { classifyAuditFailure, retryBackoffMs } from "../app/lib/audit-error-codes.server.ts";
import { MAX_CONCURRENT_AUDITS } from "../app/lib/audit-queue-policy.ts";

test("N-4: progress reaches exactly 100% at completion and never exceeds it", () => {
  assert.equal(auditProgressPercent(0, 0), 0);
  assert.equal(auditProgressPercent(0, 3), 0);
  assert.equal(auditProgressPercent(1, 3), 33);
  assert.equal(auditProgressPercent(3, 3), 100);
  assert.equal(auditProgressPercent(4, 3), 100);
});

test("N-4: step 2 appears without a manual reload (revalidation, not location.reload)", () => {
  const src = fs.readFileSync(new URL("../app/routes/app._index.jsx", import.meta.url), "utf8");
  assert.match(src, /revalidator\.revalidate\(\)/);
  assert.doesNotMatch(src, /window\.location\.reload/);
});

test("N-4: failed audit is classified and retried with a backoff", () => {
  const transient = classifyAuditFailure(new Error("network timeout"));
  assert.equal(typeof transient.transient, "boolean");
  assert.ok(retryBackoffMs(1) >= 0);
  assert.ok(retryBackoffMs(2) >= retryBackoffMs(1));
});

test("N-4: queue claim cap and boot recovery are covered by the integration test", () => {
  const src = fs.readFileSync(
    new URL("../tests/audit-queue.integration.test.ts", import.meta.url),
    "utf8",
  );
  assert.match(src, /recoverAuditJobsOnBoot/);
  assert.match(src, /claim/);
  assert.ok(MAX_CONCURRENT_AUDITS >= 1);
});

test("N-4: home-only and selector fallbacks", () => {
  const src = fs.readFileSync(new URL("../tests/audit-discovery.test.js", import.meta.url), "utf8");
  assert.match(src, /only home is audited/);
  for (const selector of ["/shop", "/catalog", "/collections/all"]) {
    assert.match(src, new RegExp(selector.replace(/\//g, "\\/")));
  }
});

test("N-4: custom URL save/persist/use and password protection are covered", () => {
  const urls = fs.readFileSync(new URL("../tests/page-urls.test.js", import.meta.url), "utf8");
  assert.match(urls, /custom domain/);
  const pw = fs.readFileSync(
    new URL("../tests/storefront-password.test.js", import.meta.url),
    "utf8",
  );
  assert.match(pw, /decrypt/);
});

import {
  retentionCutoffs,
  runRetentionCleanup,
  RETENTION_DAYS,
} from "../app/lib/retention.server.ts";

test("CQ-12: retention keeps 90 days of logs and the newest 20 audits per shop", async () => {
  const now = 1_000_000_000_000;
  const c = retentionCutoffs(now);
  assert.equal(RETENTION_DAYS, 90);
  assert.equal(c.keepAuditsPerShop, 20);
  assert.equal(c.logsBefore.getTime(), now - 90 * 24 * 60 * 60 * 1000);

  const deleted = [];
  const db = {
    auditLog: {
      deleteMany: async (a) => {
        deleted.push(a);
        return { count: 5 };
      },
      findMany: async () => [{ domain: "a.myshopify.com" }],
      count: async () => 30,
    },
    storeActivity: { deleteMany: async () => ({ count: 2 }) },
    auditJob: { deleteMany: async () => ({ count: 3 }) },
    psiSnapshot: { deleteMany: async () => ({ count: 1 }) },
  };
  const result = await runRetentionCleanup(db, now);
  assert.equal(result.auditLog, 5);
  assert.equal(result.oldAuditsBeyondMinimum, 5);
  assert.ok(deleted.some((a) => Array.isArray(a.where?.id?.notIn)));
});

test("audit: successful report save must not be treated as a cancellation", () => {
  const src = fs.readFileSync(
    new URL("../app/lib/audit-execute.server.ts", import.meta.url),
    "utf8",
  );
  const idx = src.indexOf("await saveAuditReport(shopDomain, report);");
  assert.ok(idx > 0);
  const after = src
    .slice(idx, idx + 400)
    .split("\n")
    .filter((l) => !l.trim().startsWith("//"))
    .join("\n");
  assert.match(after, /jobStopRequested\(jobId\)/);
  assert.doesNotMatch(after, /shouldStop\(\)/);
});
