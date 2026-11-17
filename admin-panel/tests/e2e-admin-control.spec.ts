/**
 * Phase 5 smoke — run manually when admin + merchant dev are up:
 *   cd admin-panel && npx playwright test tests/e2e-admin-control.spec.ts
 *
 * Requires ADMIN_SESSION_PASSWORD in env and a known store domain.
 */
import { test, expect } from "@playwright/test";

const storeDomain =
  process.env.E2E_STORE_DOMAIN || "rishabh-dev-store-mdqu0epm.myshopify.com";

test.skip(!process.env.ADMIN_E2E, "Set ADMIN_E2E=1 to run admin bridge e2e");

test("store state API returns ok when bridge is healthy", async ({ request }) => {
  const login = await request.post("http://localhost:3000/api/auth/login", {
    data: {
      email: process.env.E2E_ADMIN_EMAIL || "admin@pagepulse.com",
      password: process.env.E2E_ADMIN_PASSWORD || "",
    },
  });
  expect(login.ok()).toBeTruthy();
  const state = await request.get(
    `http://localhost:3000/api/stores/${encodeURIComponent(storeDomain)}/state`,
  );
  expect(state.ok()).toBeTruthy();
  const body = await state.json();
  expect(body.ok).toBe(true);
  expect(body.setup).toBeTruthy();
});