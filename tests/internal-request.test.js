import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  internalAuthOk,
  parseInternalRequest,
  readInternalSecret,
} from "../app/lib/internal-request.ts";
import { decideInternalStoreControlRequest } from "../app/lib/internal-store-control-route.ts";
import { decideInternalStorefrontRequest } from "../app/lib/internal-storefront-route.ts";

const post = (body, secret = "secret") =>
  new Request("http://x", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-pagepulse-internal": secret,
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("parseInternalRequest enforces method, secret, JSON object and shopDomain in that order", async () => {
  const get = await parseInternalRequest(new Request("http://x"), "secret");
  assert.equal(get.rejection.status, 405);

  const noAuth = await parseInternalRequest(
    post({ shopDomain: "a.myshopify.com" }, "wrong"),
    "secret",
  );
  assert.equal(noAuth.rejection.status, 401);

  const badJson = await parseInternalRequest(post("{"), "secret");
  assert.equal(badJson.rejection.body.error, "Invalid JSON");

  const notObject = await parseInternalRequest(post("[1]"), "secret");
  assert.equal(notObject.rejection.status, 400);

  const noShop = await parseInternalRequest(post({ shopDomain: "  " }), "secret");
  assert.equal(noShop.rejection.body.error, "Missing shopDomain.");

  const ok = await parseInternalRequest(post({ shopDomain: " a.myshopify.com " }), "secret");
  assert.equal(ok.ok, true);
  assert.equal(ok.shopDomain, "a.myshopify.com");
});

test("production reads the secret from the process environment only", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pp-secret-"));
  const file = path.join(dir, ".env");
  fs.writeFileSync(file, "INTERNAL_API_SECRET=from-file\r\n");
  assert.equal(readInternalSecret({}, file), "from-file", "dev reads .env (CRLF safe)");
  assert.equal(readInternalSecret({ NODE_ENV: "production" }, file), "");
  assert.equal(
    readInternalSecret({ NODE_ENV: "production", INTERNAL_API_SECRET: "env" }, file),
    "env",
  );
  fs.rmSync(dir, { recursive: true });
});

test("internalAuthOk is length-safe", () => {
  assert.equal(internalAuthOk("abc", "abcd"), false);
  assert.equal(internalAuthOk("abcd", "abcd"), true);
});

test("force ON is refused in production unless explicitly allowed", async () => {
  const body = {
    shopDomain: "a.myshopify.com",
    intent: "toggle-app",
    appEnabled: true,
    force: true,
  };
  const blocked = await decideInternalStoreControlRequest(post(body), "secret", {
    NODE_ENV: "production",
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.write, null);

  const allowed = await decideInternalStoreControlRequest(post(body), "secret", {
    NODE_ENV: "production",
    ADMIN_ALLOW_FORCE_APP_ON: "true",
  });
  assert.equal(allowed.write.force, true);

  const dev = await decideInternalStoreControlRequest(post(body), "secret", {
    NODE_ENV: "development",
  });
  assert.equal(dev.write.force, true);

  const off = await decideInternalStoreControlRequest(
    post({ ...body, appEnabled: false }),
    "secret",
    { NODE_ENV: "production" },
  );
  assert.equal(off.write.force, false, "force only applies when turning ON");
});

test("control and lists decisions forward the acting admin", async () => {
  const control = await decideInternalStoreControlRequest(
    post({
      shopDomain: "a.myshopify.com",
      intent: "stop-audit",
      actorEmail: "ops@x.com",
    }),
    "secret",
  );
  assert.equal(control.write.actorEmail, "ops@x.com");

  const lists = await decideInternalStorefrontRequest(
    post({
      shopDomain: "a.myshopify.com",
      intent: "save-lists",
      scope: "home",
      patch: { defer: ["a.js"] },
      actorEmail: "ops@x.com",
    }),
    "secret",
  );
  assert.equal(lists.write.actorEmail, "ops@x.com");

  const noActor = await decideInternalStorefrontRequest(
    post({ shopDomain: "a.myshopify.com", intent: "resync" }),
    "secret",
  );
  assert.equal(noActor.write.actorEmail, null);
});

test("the merchant loader selects the columns the admin lock and polling version need", () => {
  const source = fs.readFileSync(
    new URL("../app/lib/dashboard-loader-core.ts", import.meta.url),
    "utf8",
  );
  const select = source.slice(source.indexOf("export const STORE_CONFIG_SELECT"));
  for (const column of ["adminManaged", "updatedAt", "lastAuditAt"]) {
    assert.match(select.slice(0, select.indexOf("};")), new RegExp(`\\b${column}: true`));
  }
});

test("every merchant mutation route checks the admin lock", () => {
  const read = (rel) => fs.readFileSync(new URL(`../app/routes/${rel}`, import.meta.url), "utf8");
  assert.match(read("app.settings.jsx"), /assertMerchantCanMutate/);
  assert.match(read("app._index.jsx"), /assertMerchantCanMutate/);
});
