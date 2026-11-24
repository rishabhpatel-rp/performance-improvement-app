import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("../", import.meta.url);
const read = (path) => fs.readFileSync(new URL(path, root), "utf8");

test("custom audit: the run model has no password column", () => {
  const schema = read("prisma/schema.prisma");
  const block = schema.match(/model CustomAuditRun \{([\s\S]*?)^\}/m)?.[1] ?? "";
  assert.ok(block.length > 0);
  assert.doesNotMatch(block.toLowerCase(), /password/);
});

test("custom audit: the internal route never stores the password", () => {
  const route = read("app/routes/api.internal.custom-audit.jsx");
  const createBlock = route.match(/prisma\.customAuditRun\.create\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
  assert.ok(createBlock.length > 0);
  assert.doesNotMatch(createBlock, /password/i);
});

test("custom audit: the admin GET response never returns the raw report", () => {
  const route = read("admin-panel/src/app/api/custom-audit/route.ts");
  const getBlock = route.match(/export async function GET[\s\S]*?\n\}/)?.[0] ?? "";
  assert.ok(getBlock.length > 0);
  assert.doesNotMatch(getBlock, /report/i);
});
