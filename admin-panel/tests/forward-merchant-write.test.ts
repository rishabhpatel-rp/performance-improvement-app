import { test } from "node:test";
const RUN = Math.random().toString(36).slice(2);
import assert from "node:assert/strict";
import {
  merchantWriteProblem,
  upstreamFailureDescriptor,
  isRecord,
} from "../src/lib/merchant-route.ts";
import { consumeRateLimit, loginKey, ipKey, MAX_ATTEMPTS } from "../src/lib/rate-limit.ts";

const good = {
  authenticated: true,
  demoMode: false,
  rateAllowed: true,
  retryAfterSeconds: 0,
  shopDomain: "demo.myshopify.com",
  bodyIsRecord: true,
  invalid: null,
  storeActive: true,
};

test("forward gate: missing admin session is 401", async () => {
  assert.deepEqual(merchantWriteProblem({ ...good, authenticated: false }), {
    error: "Unauthorized",
    status: 401,
  });
});

test("forward gate: demo mode blocks writes with 403", async () => {
  assert.equal(merchantWriteProblem({ ...good, demoMode: true })?.status, 403);
});

test("forward gate: throttling returns 429 with retry seconds", async () => {
  const problem = merchantWriteProblem({
    ...good,
    rateAllowed: false,
    retryAfterSeconds: 12,
  });
  assert.equal(problem?.status, 429);
  assert.match(problem!.error, /Retry in 12s/);
});

test("forward gate: bad domain and invalid body are 400", async () => {
  assert.equal(merchantWriteProblem({ ...good, shopDomain: null })?.status, 400);
  assert.equal(merchantWriteProblem({ ...good, bodyIsRecord: false })?.status, 400);
  assert.equal(merchantWriteProblem({ ...good, invalid: "bad field" })?.status, 400);
});

test("forward gate: inactive store is 404", async () => {
  assert.equal(merchantWriteProblem({ ...good, storeActive: false })?.status, 404);
});

test("forward gate: valid request passes", async () => {
  assert.equal(merchantWriteProblem(good), null);
});

test("upstream 401/403 maps to a bridge error (502), never passed through", async () => {
  for (const status of [401, 403]) {
    const result = upstreamFailureDescriptor({ ok: false }, new Response("", { status }));
    assert.equal(result.status, 502);
    assert.match(result.body.error, /INTERNAL_API_SECRET/);
  }
});

test("upstream 500 keeps its status and surfaces the upstream message", async () => {
  const result = upstreamFailureDescriptor(
    { ok: false, error: "boom" },
    new Response("", { status: 500 }),
  );
  assert.equal(result.status, 500);
  assert.equal(result.body.error, "boom");
});

test("login throttle blocks after MAX_ATTEMPTS failures and expires", async () => {
  const now = 1_000_000;
  const key = loginKey(`${RUN}:User@Example.COM`, "1.2.3.4");
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    assert.equal(
      (await consumeRateLimit(key, { max: MAX_ATTEMPTS, windowMs: 1000 }, now)).allowed,
      true,
    );
  }
  assert.equal(
    (await consumeRateLimit(key, { max: MAX_ATTEMPTS, windowMs: 1000 }, now)).allowed,
    false,
  );
  assert.equal(
    (await consumeRateLimit(key, { max: MAX_ATTEMPTS, windowMs: 1000 }, now + 1001)).allowed,
    true,
  );
});

test("login throttle keeps a separate per-IP bucket", async () => {
  const now = 2_000_000;
  const key = ipKey(`${RUN}:9.9.9.9`);
  for (let i = 0; i < 3; i++) await consumeRateLimit(key, { max: 3, windowMs: 1000 }, now);
  assert.equal((await consumeRateLimit(key, { max: 3, windowMs: 1000 }, now)).allowed, false);
  assert.equal(
    (await consumeRateLimit(ipKey(`${RUN}:8.8.8.8`), { max: 3, windowMs: 1000 }, now)).allowed,
    true,
  );
});

test("isRecord rejects arrays and null", async () => {
  assert.equal(isRecord({ a: 1 }), true);
  assert.equal(isRecord([]), false);
  assert.equal(isRecord(null), false);
});

import { originProblem } from "../src/lib/merchant-route.ts";
import { demoStateForDomain } from "../src/lib/demo-state.ts";
import { getAllDummyStores } from "../src/lib/dummy-data.ts";

test("A-2: cross-origin writes are rejected, same-origin allowed", () => {
  const base = new Request("https://admin.example.com/api/stores/x/script", { method: "POST" });
  assert.equal(originProblem(base), null);
  const same = new Request("https://admin.example.com/api/stores/x/script", {
    method: "POST",
    headers: { origin: "https://admin.example.com", "sec-fetch-site": "same-origin" },
  });
  assert.equal(originProblem(same), null);
  const cross = new Request("https://admin.example.com/api/stores/x/script", {
    method: "POST",
    headers: { origin: "https://evil.example.com" },
  });
  assert.equal(originProblem(cross)?.status, 403);
  const crossSite = new Request("https://admin.example.com/api/stores/x/script", {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
  });
  assert.equal(originProblem(crossSite)?.status, 403);
});

test("A-2: local-dev LAN origin matches Host / localhost on same port", () => {
  const viaHost = new Request("http://localhost:3000/api/stores/x/control", {
    method: "POST",
    headers: {
      origin: "http://192.168.13.187:3000",
      host: "192.168.13.187:3000",
      "sec-fetch-site": "same-origin",
    },
  });
  assert.equal(originProblem(viaHost), null);

  const viaLocalPair = new Request("http://127.0.0.1:3000/api/stores/x/control", {
    method: "POST",
    headers: {
      origin: "http://localhost:3000",
      "sec-fetch-site": "cross-site",
    },
  });
  assert.equal(originProblem(viaLocalPair), null);
});

test("A-2: GET requests are not origin-checked", () => {
  const req = new Request("https://admin.example.com/api/stores/x/state", {
    method: "GET",
    headers: { origin: "https://evil.example.com" },
  });
  assert.equal(originProblem(req), null);
});

test("A-3: demo state is read-only and comes from dummy data", () => {
  const state = demoStateForDomain("aurora-apparel.myshopify.com");
  // Domains are generated from store slugs; use any dummy domain from the dataset.
  if (!state) {
    const first = getAllDummyStores()[0];
    const fallback = demoStateForDomain(first.shopDomain);
    assert.ok(fallback);
    assert.equal(fallback.demoMode, true);
    return;
  }
  assert.equal(state.demoMode, true);
  assert.equal(typeof state.auditStatus.complete, "boolean");
});
