import test from "node:test";
import assert from "node:assert/strict";
import {
  applyPsiPreviewBypass,
  hasPsiPreviewBypass,
  isPreviewBypassExpired,
  parseThemePreviewShareUrl,
  shouldSkipPsiForPasswordStore,
} from "../app/lib/psi-preview-url.server.ts";

const SHOP = "rishabh-dev-store-mdqu0epm.myshopify.com";
const SAMPLE =
  "https://rishabh-dev-store-mdqu0epm.myshopify.com/?_ab=0&_bt=token&_fd=0&_sc=1&key=abc123&preview_theme_id=161003143395";

test("parseThemePreviewShareUrl extracts bypass params", () => {
  const r = parseThemePreviewShareUrl(SAMPLE, SHOP);
  assert.equal(r.ok, true);
  assert.equal(r.params._bt, "token");
  assert.equal(r.params.key, "abc123");
  assert.equal(r.params.preview_theme_id, "161003143395");
});

test("applyPsiPreviewBypass applies params to collection path", () => {
  const r = parseThemePreviewShareUrl(SAMPLE, SHOP);
  assert.equal(r.ok, true);
  const url = applyPsiPreviewBypass(`https://${SHOP}/collections/all`, r.params);
  const u = new URL(url);
  assert.equal(u.searchParams.get("key"), "abc123");
  assert.equal(u.searchParams.get("_bt"), "token");
  assert.equal(u.pathname, "/collections/all");
  assert.equal(u.searchParams.has("password"), false);
});

test("shouldSkipPsiForPasswordStore when password protected", () => {
  assert.equal(shouldSkipPsiForPasswordStore(true, { _bt: "x", key: "y" }), true);
  assert.equal(shouldSkipPsiForPasswordStore(true, null), true);
  assert.equal(shouldSkipPsiForPasswordStore(false, null), false);
});

test("hasPsiPreviewBypass requires _bt and key", () => {
  assert.equal(hasPsiPreviewBypass({ _bt: "x", key: "y" }), true);
  assert.equal(hasPsiPreviewBypass({ _bt: "x" }), false);
});

test("isPreviewBypassExpired reads exp inside _bt payload", () => {
  const past = Buffer.from(
    JSON.stringify({ exp: "2020-01-01T00:00:00.000Z" }),
  ).toString("base64");
  assert.equal(isPreviewBypassExpired({ _bt: `${past}--sig`, key: "k" }), true);
});
