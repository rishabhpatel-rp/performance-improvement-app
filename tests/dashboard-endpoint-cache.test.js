import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  resolveStoreIdForCache,
  cachedAppEndpointValue,
  cacheAppEndpoint,
} from "../app/lib/dashboard-endpoint-cache.server.ts";

function fakeDb(impl) {
  const calls = [];
  return {
    calls,
    storeConfig: {
      upsert: async (args) => {
        calls.push(args);
        if (impl) impl(args);
      },
    },
  };
}

const silentLogger = { error() {} };

test("new store uses the id returned by upsertStore, not the pre-upsert snapshot", () => {
  assert.equal(resolveStoreIdForCache(null, { id: "new-store" }), "new-store");
  assert.equal(resolveStoreIdForCache(undefined, { id: "new-store" }), "new-store");
});

test("existing store keeps its id", () => {
  assert.equal(resolveStoreIdForCache({ id: "same" }, { id: "same" }), "same");
  assert.equal(resolveStoreIdForCache({ id: "old" }, null), "old");
});

test("missing store id resolves to null", () => {
  assert.equal(resolveStoreIdForCache(null, null), null);
});

test("cached endpoint prefers Shopify config, then app URL, then null", () => {
  assert.equal(
    cachedAppEndpointValue({ appEndpoint: "https://cfg" }, "https://url"),
    "https://cfg",
  );
  assert.equal(cachedAppEndpointValue({}, "https://url"), "https://url");
  assert.equal(cachedAppEndpointValue(null, ""), null);
});

test("cacheAppEndpoint writes the upserted store id on first visit", async () => {
  const db = fakeDb();
  const written = await cacheAppEndpoint(db, "new-store", "https://cfg", silentLogger);
  assert.equal(written, true);
  assert.equal(db.calls.length, 1);
  assert.equal(db.calls[0].where.storeId, "new-store");
  assert.equal(db.calls[0].create.storeId, "new-store");
  assert.equal(db.calls[0].create.cachedAppEndpoint, "https://cfg");
  assert.equal(db.calls[0].update.cachedAppEndpoint, "https://cfg");
});

test("cacheAppEndpoint skips when no store id is available", async () => {
  const db = fakeDb();
  const written = await cacheAppEndpoint(db, null, "https://cfg", silentLogger);
  assert.equal(written, false);
  assert.equal(db.calls.length, 0);
});

test("cacheAppEndpoint logs and swallows a DB failure", async () => {
  const db = fakeDb(() => {
    throw new Error("db down");
  });
  const errors = [];
  const written = await cacheAppEndpoint(db, "new-store", "https://cfg", {
    error: (...args) => errors.push(args),
  });
  assert.equal(written, false);
  assert.equal(errors.length, 1);
});

test("dashboard loader uses the resolved id instead of the pre-upsert store", () => {
  const source = fs.readFileSync(new URL("../app/routes/app._index.jsx", import.meta.url), "utf8");
  assert.match(source, /resolveStoreIdForCache\(store, upsertedStore\)/);
  assert.match(source, /cacheAppEndpoint\(\s*prisma,\s*persistedStoreId,/);
  assert.doesNotMatch(source, /where: \{ storeId: store\.id \}/);
});
