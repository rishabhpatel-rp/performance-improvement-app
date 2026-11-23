/**
 * Opt-in smoke test for the admin -> merchant bridge. Run with both dev servers up:
 *
 *   ADMIN_E2E=1 E2E_STORE_DOMAIN=<shop>.myshopify.com \
 *   E2E_ADMIN_EMAIL=<email> E2E_ADMIN_PASSWORD=<password> npm test
 *
 * Skipped unless ADMIN_E2E is set. Uses only node:test + fetch (no extra deps).
 */
import test from "node:test";
import assert from "node:assert/strict";

const enabled = Boolean(process.env.ADMIN_E2E);
const baseUrl = process.env.E2E_ADMIN_URL || "http://localhost:3000";

test("store state API returns ok when the bridge is healthy", { skip: !enabled }, async () => {
  const { E2E_STORE_DOMAIN, E2E_ADMIN_EMAIL, E2E_ADMIN_PASSWORD } = process.env;
  assert.ok(
    E2E_STORE_DOMAIN && E2E_ADMIN_EMAIL && E2E_ADMIN_PASSWORD,
    "Set E2E_STORE_DOMAIN, E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD",
  );

  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: E2E_ADMIN_EMAIL, password: E2E_ADMIN_PASSWORD }),
  });
  assert.ok(login.ok, `login failed (HTTP ${login.status})`);
  const cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  const state = await fetch(`${baseUrl}/api/stores/${encodeURIComponent(E2E_STORE_DOMAIN)}/state`, {
    headers: { cookie },
  });
  assert.ok(state.ok, `state failed (HTTP ${state.status})`);
  const body = (await state.json()) as { ok?: boolean; setup?: unknown };
  assert.equal(body.ok, true);
  assert.ok(body.setup);
});
