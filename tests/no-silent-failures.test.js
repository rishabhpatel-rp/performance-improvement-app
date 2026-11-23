import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { validateIntent, INTENT_SCHEMAS } from "../app/lib/action-schemas.ts";
import path from "node:path";

function sourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !entry.name.endsWith(".org")) out.push(full);
  }
  return out;
}

const files = sourceFiles(path.join(process.cwd(), "app"));

const GENERATED_BROWSER_CODE = new Set([
  "app/lib/audit-metrics.server.ts",
  "app/lib/audit-script.ts",
  "app/lib/script-generator.js",
]);

test("no empty catch blocks in server code", () => {
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    if (GENERATED_BROWSER_CODE.has(rel)) continue;
    const src = fs.readFileSync(file, "utf8");
    if (/catch\s*(?:\([^)]*\))?\s*\{\s*\}/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("dashboard loader routes background work through fireAndForget", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "app/routes/app._index.jsx"), "utf8");
  assert.match(src, /fireAndForget\(embedPromise,/);
  assert.match(src, /fireAndForget\(refreshPasswordProtection/);
  assert.doesNotMatch(src, /embedPromise\.catch\(\(\) => \{\}\)/);
});

test("comments explain why, not change history", () => {
  const offenders = [];
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    if (/\/\/\s*NEW\b|Plan 1, item|previously this|Previously it only/.test(src)) {
      offenders.push(path.relative(process.cwd(), file));
    }
  }
  assert.deepEqual(offenders, []);
});

test("eslint enforces no-empty and no-floating-promises", () => {
  const src = fs.readFileSync(path.join(process.cwd(), ".eslintrc.cjs"), "utf8");
  assert.match(src, /"no-empty":/);
  assert.match(src, /"@typescript-eslint\/no-floating-promises":/);
});

test("CQ-9: every intent has a field schema", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "app/lib/dashboard-actions.server.ts"),
    "utf8",
  );
  const intents = [...src.matchAll(/^ {2}"([a-z-]+)": handle/gm)].map((m) => m[1]);
  assert.ok(intents.length >= 10);
  for (const intent of intents) assert.ok(INTENT_SCHEMAS[intent], `missing schema for ${intent}`);
});

test("CQ-9: malformed toggle input is rejected with the failing field", () => {
  const fd = new FormData();
  fd.set("appEnabled", "yes");
  const verdict = validateIntent("toggle-app", fd);
  assert.equal(verdict.ok, false);
  assert.ok(verdict.errors.appEnabled);
});

test("CQ-9: valid input passes", () => {
  const fd = new FormData();
  fd.set("appEnabled", "true");
  assert.equal(validateIntent("toggle-app", fd).ok, true);
});

test("CQ-8: every UI route with a loader uses the shared error boundary", () => {
  for (const name of ["app.jsx", "app._index.jsx", "app.settings.jsx", "app.extension.jsx"]) {
    const src = fs.readFileSync(path.join(process.cwd(), "app/routes", name), "utf8");
    assert.match(src, /RouteErrorBoundary/, `${name} lacks the shared error boundary`);
  }
  const boundary = fs.readFileSync(
    path.join(process.cwd(), "app/components/RouteErrorBoundary.tsx"),
    "utf8",
  );
  assert.match(boundary, /SupportError/);
  const support = fs.readFileSync(
    path.join(process.cwd(), "app/components/SupportError.tsx"),
    "utf8",
  );
  assert.match(support, /messages\.retry/);
  assert.match(support, /messages\.copyDiagnostics/);
  assert.match(support, /messages\.supportHelp/);
});

test("CQ-11: both apps share one set of core types", () => {
  const app = fs.readFileSync(path.join(process.cwd(), "app/lib/audit-lifecycle.ts"), "utf8");
  const admin = fs.readFileSync(path.join(process.cwd(), "admin-panel/src/lib/types.ts"), "utf8");
  assert.match(app, /shared\/pagepulse-types/);
  assert.match(admin, /shared\/pagepulse-types/);
});

test("CQ-2: env reads are centralized", () => {
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(process.cwd(), file);
    if (
      rel.endsWith("env.server.ts") ||
      rel.endsWith("db.server.js") ||
      rel.endsWith("worker/audit-worker.ts") ||
      rel.endsWith("worker/worker-env.ts")
    )
      continue;
    const src = fs.readFileSync(file, "utf8");
    if (/process\.env\.[A-Z_]+/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("P1-7: schema drift guard runs in CI", () => {
  const ci = fs.readFileSync(path.join(process.cwd(), ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /check:schema/);
  const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8"));
  assert.match(pkg.scripts["check:schema"], /check-schema-drift/);
});
