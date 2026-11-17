import test from "node:test";
import assert from "node:assert/strict";
import { decideInternalStoreControlRequest } from "../app/lib/internal-store-control-route.js";

const base = {
  shopDomain: "test.myshopify.com",
  actorEmail: "admin@pagepulse.com",
};

test("select-theme is no longer an internal control intent", async () => {
  const d = await decideInternalStoreControlRequest(
    new Request("http://x", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": "secret",
      },
      body: JSON.stringify({ ...base, intent: "select-theme", themeId: "gid" }),
    }),
    "secret",
  );
  assert.equal(d.status, 400);
});

test("toggle-app accepted", async () => {
  const d = await decideInternalStoreControlRequest(
    new Request("http://x", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": "secret",
      },
      body: JSON.stringify({ ...base, intent: "toggle-app", appEnabled: true }),
    }),
    "secret",
  );
  assert.equal(d.write?.kind, "toggle-app");
});

test("set-admin-managed accepted", async () => {
  const d = await decideInternalStoreControlRequest(
    new Request("http://x", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": "secret",
      },
      body: JSON.stringify({ ...base, intent: "set-admin-managed", adminManaged: true }),
    }),
    "secret",
  );
  assert.equal(d.write?.kind, "set-admin-managed");
});