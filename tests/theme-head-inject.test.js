import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  patchThemeLayoutHead,
  THEME_RENDER_MARKER,
} from "../app/lib/theme-head-patch.js";
import {
  findSnippetPath,
  readExtensionInlineSnippetLiquid,
} from "../app/lib/theme-head-inject-utils.js";

test("readExtensionInlineSnippetLiquid finds the extension snippet", () => {
  const body = readExtensionInlineSnippetLiquid();
  assert.match(body, /\$app:pagepulse/);
  assert.match(body, /\(0,eval\)/);
});

test("findSnippetPath walks up from a build chunk directory", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const fakeChunk = path.join(repoRoot, "build/server/assets");
  const found = findSnippetPath([fakeChunk]);
  assert.equal(
    found,
    path.join(repoRoot, "extensions/script-injector/snippets/pagepulse-inline.liquid"),
  );
});

test("patchThemeLayoutHead inserts render immediately after <head>", () => {
  const input = `<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n</head>\n<body></body>\n</html>`;
  const out = patchThemeLayoutHead(input);
  assert.match(out, /<head>\s*\{% render 'pagepulse-head-inline' %\}/);
  assert.ok(out.indexOf(THEME_RENDER_MARKER) < out.indexOf("<meta charset"));
});

test("patchThemeLayoutHead is idempotent", () => {
  const once = patchThemeLayoutHead("<html><head></head></html>");
  const twice = patchThemeLayoutHead(once);
  assert.equal(once, twice);
});

test("patchThemeLayoutHead supports attributes on <head>", () => {
  const out = patchThemeLayoutHead('<html><head class="x"></head></html>');
  assert.match(out, /<head class="x">\s*\{% render 'pagepulse-head-inline' %\}/);
});
