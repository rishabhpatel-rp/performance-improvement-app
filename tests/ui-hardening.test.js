import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { messages, message } from "../app/lib/messages.ts";

test("UX-11: merchant copy is centralized and free of developer codes", () => {
  assert.equal(message("retry"), "Retry");
  assert.ok(Object.keys(messages).length >= 20);
  for (const value of Object.values(messages)) {
    assert.doesNotMatch(value, /extension_required|PASSWORD_REQUIRED|UNKNOWN/);
  }
});

test("U-2: progress area announces status to assistive tech", () => {
  const src = fs.readFileSync(
    new URL("../app/components/step1/Step1AuditRunning.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /role="status"/);
  assert.match(src, /aria-live="polite"/);
});

test("UX-12: disabled steps explain why", () => {
  const src = fs.readFileSync(
    new URL("../app/components/WizardNavigation.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /messages\.describeDisabled/);
});

test("UX-17: Step 2 autosave reports saving/saved state", () => {
  const src = fs.readFileSync(
    new URL("../app/components/Step2Configure.tsx", import.meta.url),
    "utf8",
  );
  assert.match(src, /fetcher\.state !== "idle"/);
  assert.match(src, /messages\.saving/);
  assert.match(src, /messages\.saved/);
});

test("UX-22: audit polling pauses while the tab is hidden", () => {
  const src = fs.readFileSync(new URL("../app/routes/app._index.jsx", import.meta.url), "utf8");
  assert.match(src, /document\.visibilityState !== "visible"\) return/);
  assert.match(src, /addEventListener\("visibilitychange"/);
});

test("UX-23: destructive reset requires confirmation", () => {
  const src = fs.readFileSync(new URL("../app/routes/app.settings.jsx", import.meta.url), "utf8");
  assert.match(src, /confirm\(/);
});

test("U-1/UX-10: shared CSS with design tokens is linked", () => {
  const root = fs.readFileSync(new URL("../app/root.jsx", import.meta.url), "utf8");
  assert.match(root, /app\.css\?url/);
  const css = fs.readFileSync(new URL("../app/app.css", import.meta.url), "utf8");
  assert.match(css, /--pp-color-success/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /max-width: 480px/);
});

const readUi = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");

test("U-2: interactive fields have accessible names and error descriptions", () => {
  const urls = readUi("app/components/step1/CustomUrlFields.tsx");
  assert.match(urls, /aria-describedby=\{describedBy\(/);
  assert.match(urls, /aria-invalid=/);
  assert.match(urls, /aria-live="polite"/);
  const titles = readUi("app/components/Step3Titles.tsx");
  assert.match(titles, /aria-label=\{`\$\{field\.label\} delay in seconds`\}/);
  assert.match(titles, /labelAccessibilityVisibility="exclusive"/);
  const progress = readUi("app/components/WizardProgress.tsx");
  assert.match(progress, /role="button"/);
  assert.match(progress, /aria-disabled=/);
});

test("U-2: focus rings are applied to primary controls", () => {
  for (const f of [
    "app/components/step1/CustomUrlFields.tsx",
    "app/components/step1/PasswordBox.tsx",
    "app/components/AuditReportPanel.tsx",
    "app/components/SupportError.tsx",
  ]) {
    assert.match(readUi(f), /pp-focus-ring/, `${f} lacks focus ring`);
  }
});

test("U-5: URL fields validate on blur", () => {
  const src = readUi("app/components/step1/CustomUrlFields.tsx");
  assert.match(src, /onBlur=\{onBlurPlp\}/);
  assert.match(src, /onBlur=\{onBlurPdp\}/);
  assert.match(src, /onBlur=\{\(e: any\) => onBlurExtra/);
  assert.match(src, /normalizeCustomUrl\(value, shopDomain/);
});

test("U-6: unsaved changes guard is wired", () => {
  const src = readUi("app/components/Step1Activate.tsx");
  assert.match(src, /addEventListener\("beforeunload", warn\)/);
  assert.match(src, /messages\.unsavedChanges/);
});

test("U-7: read-only state has one message below the brand image", () => {
  const step1 = readUi("app/components/Step1Activate.tsx");
  assert.match(step1, /messages\.readOnly/);
  assert.match(step1, /Glossy-Performance\.avif/);
  assert.match(step1, /role="alert"/);
  const urls = readUi("app/components/step1/CustomUrlFields.tsx");
  assert.match(urls, /disabled=\{readOnly\}/);
  assert.doesNotMatch(urls, /messages\.readOnly/);
  const pw = readUi("app/components/step1/PasswordBox.tsx");
  assert.doesNotMatch(pw, /messages\.readOnly/);
  const route = readUi("app/routes/app._index.jsx");
  assert.doesNotMatch(route, /configured by the PagePulse team/);
});

test("U-8: responsive grid and table classes are applied", () => {
  const titles = readUi("app/components/Step3Titles.tsx");
  assert.equal((titles.match(/pp-responsive-grid/g) || []).length, 2);
  const report = readUi("app/components/AuditReportPanel.tsx");
  assert.match(report, /pp-table-scroll/);
});

test("UX-18: loading skeletons are used", () => {
  const src = readUi("app/components/Step3AuditResults.tsx");
  assert.match(src, /<Skeleton/);
  const skeleton = readUi("app/components/Skeleton.tsx");
  assert.match(skeleton, /aria-busy="true"/);
  assert.match(skeleton, /role="status"/);
});

test("UX-19: report table has search, show more, copy and empty state", () => {
  const src = readUi("app/components/AuditReportPanel.tsx");
  assert.match(src, /type="search"/);
  assert.match(src, /Show more/);
  assert.match(src, /navigator\.clipboard\.writeText\(copyableValue\(row\)\)/);
  assert.match(src, /No scripts match your search/);
  assert.match(src, /severityLabel\(String\(row\.status\)\)/);
});

test("UX-20: password field keeps only the saved state and no show/test controls", () => {
  const src = readUi("app/components/step1/PasswordBox.tsx");
  assert.doesNotMatch(src, /Password saved/);
  assert.match(src, /type="password"/);
  assert.match(src, /alignItems: "flex-start"/);
  assert.doesNotMatch(src, /Test password/);
  assert.doesNotMatch(src, /Show password/);
  assert.doesNotMatch(src, /We never show the saved value/);
  const messages = readUi("app/lib/messages.ts");
  assert.doesNotMatch(messages, /Leave blank and we'll pick them for you/);
});

test("UX-21: support-friendly errors with copy diagnostics", () => {
  const src = readUi("app/components/SupportError.tsx");
  for (const marker of [
    "messages.supportIntro",
    "messages.retry",
    "messages.copyDiagnostics",
    "messages.supportHelp",
  ]) {
    assert.match(src, new RegExp(marker.replace(/\./g, "\\.")), `${marker} missing`);
  }
  for (const f of [
    "app/components/RouteErrorBoundary.tsx",
    "app/components/Step1Activate.tsx",
    "app/components/Step3AuditResults.tsx",
    "app/components/Step2Configure.tsx",
  ]) {
    assert.match(readUi(f), /SupportError/, `${f} lacks SupportError`);
  }
});

import { filterScriptRows, severityLabel, copyableValue } from "../app/lib/report-table.ts";
import { describedBy, errorId, stepHeadingLabel } from "../app/lib/a11y.ts";

test("UX-19: report table helpers filter, label severity and pick copy text", () => {
  const rows = [
    { token: "analytics.js", domain: "cdn.example.com", status: "deferred" },
    { token: "app.js", domain: "shopify.com", status: "protected" },
  ];
  assert.equal(filterScriptRows(rows, "analytics").length, 1);
  assert.equal(filterScriptRows(rows, "  ").length, 2);
  assert.equal(severityLabel("deferred"), "Deferred");
  assert.equal(severityLabel("unknown-code"), "Review");
  assert.equal(copyableValue(rows[0]), "analytics.js");
});

test("U-2: a11y helpers produce stable ids and step labels", () => {
  assert.equal(describedBy("plp-url", true), "plp-url-error");
  assert.equal(describedBy("plp-url", false), undefined);
  assert.equal(errorId("pdp-url"), "pdp-url-error");
  assert.equal(stepHeadingLabel(1), "Step 1: Activate");
  assert.equal(stepHeadingLabel(2), "Step 2: Configure");
});
