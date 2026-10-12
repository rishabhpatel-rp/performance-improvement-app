import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHUNK_CHARS,
  INLINE_CAPACITY_CHARS,
  MAX_CHUNKS,
  METAFIELD_KEY,
  METAFIELD_NAMESPACE,
  METAFIELD_PARTS_KEY,
  allMetafieldKeys,
  chunkKey,
  deleteScriptMetafield,
  hashScript,
  isSafeForInline,
  planMetafieldSync,
  seedFromShop,
  splitScript,
  writeScriptMetafield,
} from "../app/lib/script-inline.js";

test("isSafeForInline rejects empty, </script and <!--", () => {
  assert.equal(isSafeForInline("var a=1;").ok, true);
  assert.equal(isSafeForInline("").ok, false);
  assert.equal(isSafeForInline(null).ok, false);
  assert.equal(isSafeForInline("x='</script>'").ok, false);
  assert.equal(isSafeForInline("x='</SCRIPT >'").ok, false);
  assert.equal(isSafeForInline("x='<!--'").ok, false);
});

test("seedFromShop is stable, shop specific and never 0", () => {
  const a = seedFromShop("a.myshopify.com");
  assert.equal(a, seedFromShop("a.myshopify.com"));
  assert.notEqual(a, seedFromShop("b.myshopify.com"));
  assert.ok(Number.isInteger(a) && a > 0 && a <= 0xffffffff);
});

test("planMetafieldSync: write when new or changed", () => {
  const script = "var a=1;";
  const hash = hashScript(script);
  assert.deepEqual(planMetafieldSync({ script, scriptHash: hash, metafieldHash: null }), {
    action: "write",
    hash,
  });
  assert.equal(
    planMetafieldSync({ script, scriptHash: hash, metafieldHash: "old" }).action,
    "write",
  );
  // scriptHash missing: derived from the script
  assert.equal(
    planMetafieldSync({ script, scriptHash: null, metafieldHash: null }).hash,
    hash,
  );
});

test("planMetafieldSync: noop when already current", () => {
  const script = "var a=1;";
  const hash = hashScript(script);
  assert.equal(
    planMetafieldSync({ script, scriptHash: hash, metafieldHash: hash }).action,
    "noop",
  );
});

test("planMetafieldSync: app off (empty script) clears a live metafield, else noop", () => {
  assert.equal(
    planMetafieldSync({ script: "", scriptHash: "x", metafieldHash: "live" }).action,
    "clear",
  );
  assert.equal(
    planMetafieldSync({ script: "", scriptHash: "x", metafieldHash: null }).action,
    "noop",
  );
});

test("capacity is MAX_CHUNKS chunks of CHUNK_CHARS, under Shopify's ~65k per-metafield limit", () => {
  assert.equal(INLINE_CAPACITY_CHARS, CHUNK_CHARS * MAX_CHUNKS);
  assert.ok(CHUNK_CHARS < 65535);
  assert.equal(MAX_CHUNKS, 6);
});

test("planMetafieldSync: over capacity is never inlined and clears a live copy", () => {
  const big = "a".repeat(INLINE_CAPACITY_CHARS + 1);
  assert.equal(planMetafieldSync({ script: big, scriptHash: "h", metafieldHash: null }).action, "noop");
  assert.equal(planMetafieldSync({ script: big, scriptHash: "h", metafieldHash: "live" }).action, "clear");
  const atCap = "a".repeat(INLINE_CAPACITY_CHARS);
  assert.equal(planMetafieldSync({ script: atCap, scriptHash: "h", metafieldHash: null }).action, "write");
  // a script bigger than one chunk (the old 60 KB cap) is now inlined
  const multi = "a".repeat(CHUNK_CHARS + 5000);
  assert.equal(planMetafieldSync({ script: multi, scriptHash: "h", metafieldHash: null }).action, "write");
});

test("chunkKey / allMetafieldKeys", () => {
  assert.equal(chunkKey(1), "script");
  assert.equal(chunkKey(2), "script_2");
  assert.equal(chunkKey(6), "script_6");
  assert.deepEqual(allMetafieldKeys(), [
    "script", "script_2", "script_3", "script_4", "script_5", "script_6", METAFIELD_PARTS_KEY,
  ]);
});

test("splitScript: joins back byte for byte, chunks within size", () => {
  const script = "var a='xy';".repeat(1000);
  for (const size of [50, 777, CHUNK_CHARS]) {
    const chunks = splitScript(script, size);
    assert.equal(chunks.join(""), script);
    assert.ok(chunks.every((c) => c.length > 0 && c.length <= size));
  }
  assert.deepEqual(splitScript(""), []);
  assert.deepEqual(splitScript("var a=1;"), ["var a=1;"]);
});

test("splitScript: never cuts next to whitespace or inside a surrogate pair", () => {
  const script = ("let x = 1; \u{1F600}a b\n").repeat(200).replace(/\\u\{1F600\}/g, "\u{1F600}");
  const chunks = splitScript(script, 37);
  assert.equal(chunks.join(""), script);
  for (let i = 0; i < chunks.length - 1; i++) {
    const c = chunks[i];
    const next = chunks[i + 1];
    assert.doesNotMatch(c.at(-1), /\s/, `chunk ${i} ends with whitespace`);
    assert.doesNotMatch(next[0], /\s/, `chunk ${i + 1} starts with whitespace`);
    const hi = c.charCodeAt(c.length - 1);
    assert.ok(!(hi >= 0xd800 && hi <= 0xdbff), `chunk ${i} ends mid surrogate pair`);
  }
});

test("planMetafieldSync: unsafe script is not inlined", () => {
  const plan = planMetafieldSync({ script: "x='</script>'", scriptHash: "h", metafieldHash: "live" });
  assert.equal(plan.action, "clear");
  assert.match(plan.reason, /script/);
});

function fakeAdmin(handlers) {
  const calls = [];
  return {
    calls,
    graphql: async (query, opts) => {
      calls.push({ query, variables: opts?.variables });
      const key = Object.keys(handlers).find((k) => query.includes(k));
      const data = key ? handlers[key](opts?.variables) : {};
      return { json: async () => ({ data }) };
    },
  };
}

test("writeScriptMetafield: ONE metafieldsSet with the chunk and script_parts", async () => {
  const admin = fakeAdmin({
    "shop { id }": () => ({ shop: { id: "gid://shopify/Shop/1" } }),
    metafieldsSet: () => ({ metafieldsSet: { metafields: [{ id: "m" }], userErrors: [] } }),
  });
  await writeScriptMetafield(admin, "var a=1;");
  assert.equal(admin.calls.length, 2);
  const [chunk, parts] = admin.calls[1].variables.metafields;
  assert.deepEqual(chunk, {
    ownerId: "gid://shopify/Shop/1",
    namespace: METAFIELD_NAMESPACE,
    key: METAFIELD_KEY,
    type: "multi_line_text_field",
    value: "var a=1;",
  });
  assert.deepEqual(parts, {
    ownerId: "gid://shopify/Shop/1",
    namespace: METAFIELD_NAMESPACE,
    key: METAFIELD_PARTS_KEY,
    type: "number_integer",
    value: "1",
  });
});

test("writeScriptMetafield: a long script is split across chunks in a single call", async () => {
  const admin = fakeAdmin({
    "shop { id }": () => ({ shop: { id: "gid://shopify/Shop/1" } }),
    metafieldsSet: () => ({ metafieldsSet: { metafields: [], userErrors: [] } }),
  });
  const script = "var a='xy';".repeat(Math.ceil((CHUNK_CHARS * 2 + 100) / 11));
  await writeScriptMetafield(admin, script);
  assert.equal(admin.calls.length, 2, "one shop-id read + one metafieldsSet");
  const mfs = admin.calls[1].variables.metafields;
  const chunks = mfs.filter((m) => m.key !== METAFIELD_PARTS_KEY);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((m) => m.key), ["script", "script_2", "script_3"]);
  assert.equal(chunks.map((m) => m.value).join(""), script);
  assert.equal(mfs.at(-1).value, "3");
});

test("writeScriptMetafield rejects a script that needs more than MAX_CHUNKS chunks", async () => {
  const admin = fakeAdmin({});
  await assert.rejects(
    () => writeScriptMetafield(admin, "a".repeat(INLINE_CAPACITY_CHARS + 1)),
    /max is 6/,
  );
  assert.equal(admin.calls.length, 0);
});

test("writeScriptMetafield throws on userErrors", async () => {
  const admin = fakeAdmin({
    "shop { id }": () => ({ shop: { id: "gid://shopify/Shop/1" } }),
    metafieldsSet: () => ({
      metafieldsSet: { metafields: [], userErrors: [{ message: "value too long" }] },
    }),
  });
  await assert.rejects(() => writeScriptMetafield(admin, "x"), /value too long/);
});

test("deleteScriptMetafield removes every chunk and the parts marker in one call", async () => {
  const admin = fakeAdmin({
    "shop { id }": () => ({ shop: { id: "gid://shopify/Shop/1" } }),
    metafieldsDelete: () => ({ metafieldsDelete: { deletedMetafields: [], userErrors: [] } }),
  });
  await deleteScriptMetafield(admin);
  assert.equal(admin.calls.length, 2);
  assert.deepEqual(
    admin.calls[1].variables.metafields,
    allMetafieldKeys().map((key) => ({
      ownerId: "gid://shopify/Shop/1",
      namespace: METAFIELD_NAMESPACE,
      key,
    })),
  );
});
