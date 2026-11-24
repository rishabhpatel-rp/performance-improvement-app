import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseCustomAuditUrl,
  assertPublicHost,
  sanitizeRedirect,
} from "../shared/custom-audit-url.ts";

test("custom audit URL: accepts http, https, ports and arbitrary hosts", () => {
  for (const raw of [
    "https://example.com",
    "http://example.com:8080/shop",
    "example.com/products/hat",
    "https://my-shop.co.uk/collections/all?sort_by=best",
  ]) {
    const parsed = parseCustomAuditUrl(raw);
    assert.equal(parsed.ok, true, `${raw} should be accepted`);
  }
  assert.equal(parseCustomAuditUrl("https://example.com").ok, true);
  assert.equal(parseCustomAuditUrl("https://example.com").url, "https://example.com/");
});

test("custom audit URL: rejects bad input and strips secrets", () => {
  assert.equal(parseCustomAuditUrl("").ok, false);
  assert.equal(parseCustomAuditUrl("ftp://example.com").ok, false);
  assert.equal(parseCustomAuditUrl("https://user:pass@example.com").ok, false);
  const parsed = parseCustomAuditUrl("https://example.com/?password=secret&_bt=x#frag");
  assert.equal(parsed.ok, true);
  if (parsed.ok) {
    assert.equal(parsed.url, "https://example.com/");
    assert.ok(!parsed.url.includes("secret"));
  }
});

test("custom audit URL: private hosts blocked unless explicitly allowed", async () => {
  assert.match((await assertPublicHost("http://127.0.0.1:3000/")) ?? "", /Private network/);
  process.env.CUSTOM_AUDIT_ALLOW_PRIVATE_HOSTS = "1";
  try {
    assert.equal(await assertPublicHost("http://127.0.0.1:3000/"), null);
  } finally {
    delete process.env.CUSTOM_AUDIT_ALLOW_PRIVATE_HOSTS;
  }
});

test("custom audit URL: cross-origin redirects are validated and stripped", async () => {
  process.env.CUSTOM_AUDIT_ALLOW_PRIVATE_HOSTS = "1";
  try {
    const safe = await sanitizeRedirect(
      "https://example.com/",
      "http://localhost:3000/next?password=secret",
    );
    assert.equal(safe.ok, true);
    assert.ok(!safe.url?.includes("password"));
    assert.ok(!safe.url?.includes("secret"));
  } finally {
    delete process.env.CUSTOM_AUDIT_ALLOW_PRIVATE_HOSTS;
  }
});
