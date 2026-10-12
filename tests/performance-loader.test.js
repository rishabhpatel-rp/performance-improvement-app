import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  MAX_CHUNKS,
  METAFIELD_NAMESPACE,
  chunkKey,
  splitScript,
} from "../app/lib/script-inline.js";

const liquid = fs.readFileSync(
  new URL("../extensions/script-injector/blocks/performance-loader.liquid", import.meta.url),
  "utf8",
);
const inlineSnippet = fs.readFileSync(
  new URL("../extensions/script-injector/snippets/pagepulse-inline.liquid", import.meta.url),
  "utf8",
);
const markup = inlineSnippet;

/**
 * Renders ONLY the Liquid constructs this block uses: shop/app metafield assigns,
 * `{{ pp.K.value }}`, `{% if pp.K.value (>=|!=) X %}...{% endif %}` and `{%- ... -%}`
 * whitespace control. It is not a general Liquid engine; the point is to prove the
 * block's output for the metafield states the app produces.
 */
function render(metafields) {
  const val = (key) => metafields[key];
  const schemaIdx = markup.indexOf("{% schema %}");
  let out = schemaIdx >= 0 ? markup.slice(0, schemaIdx) : markup;
  out = out.replace(/\{%-?\s*comment\s*-?%\}[\s\S]*?\{%-?\s*endcomment\s*-?%\}/g, "");
  out = out.replace(/\s*\{%-/g, "{%").replace(/-%\}\s*/g, "%}");
  out = out.replace(/\{%\s*assign[\s\S]*?%\}/g, "");
  out = out.replace(/\{%\s*if pp\.script\.value\s*==\s*blank\s*%\}[\s\S]*?\{%\s*endif\s*%\}/g, "");

  if (!metafields.script) {
    return "";
  }

  const ifRe = /\{%\s*if pp\.(\w+)\.value\s*(>=|!=)\s*(\w+)\s*%\}((?:(?!\{%\s*if)[\s\S])*?)\{%\s*endif\s*%\}/;
  for (let guard = 0; guard < 50; guard++) {
    const m = ifRe.exec(out);
    if (!m) break;
    const [whole, key, op, rhs, body] = m;
    const v = val(key);
    const ok =
      op === ">="
        ? typeof v === "number" && v >= Number(rhs)
        : rhs === "blank"
          ? !(v === undefined || v === null || v === "")
          : v !== rhs;
    out = out.replace(whole, ok ? body : "");
  }

  out = out.replace(/\{\{\s*pp\.(\w+)\.value\s*\|\s*json\s*\}\}/g, (_, k) =>
    JSON.stringify(val(k) ?? ""),
  );
  return out.replace(/\{\{\s*pp\.(\w+)\.value\s*\}\}/g, (_, k) => val(k) ?? "");
}

/** Build expected HTML for json+eval inline delivery (matches pagepulse-inline.liquid). */
function expectedInlineHtml(chunks) {
  const parts = chunks.map((c) => JSON.stringify(c)).join("+");
  return `<script>(function(){var __ppS=${parts};(0,eval)(__ppS);})();</script>`;
}

function stored(script) {
  const chunks = splitScript(script, 50);
  const mf = { script_parts: chunks.length };
  chunks.forEach((c, i) => (mf[chunkKey(i + 1)] = c));
  return mf;
}

test("embed is rendered first in <head>, as the only supported target", () => {
  const schema = JSON.parse(liquid.match(/\{%\s*schema\s*%\}([\s\S]*?)\{%\s*endschema\s*%\}/)[1]);
  assert.equal(schema.target, "compliance_head");
});

test("no <script src>, no proxy URL, no network request in the block", () => {
  assert.doesNotMatch(markup, /<script[^>]*\ssrc\s*=/i);
  assert.doesNotMatch(inlineSnippet, /apps\/performance-scripts/);
  assert.doesNotMatch(markup, /\{%-?\s*else\s*-?%\}/, "nothing rendered when blank: no else branch");
});

test("embed defers to theme head when theme_head_active is set", () => {
  assert.match(liquid, /unless app\.metafields\.pagepulse\.theme_head_active/);
  assert.match(liquid, /render 'pagepulse-inline'/);
});

test("namespace in Liquid matches the app-owned namespace the server writes", () => {
  assert.equal(METAFIELD_NAMESPACE, "$app:pagepulse");
  assert.match(markup, /\$app:pagepulse/);
  assert.match(markup, /shop\.metafields\[pp_ns\]/);
});

test("the Liquid reads exactly MAX_CHUNKS chunks, matching the server", () => {
  const keys = [...markup.matchAll(/pp\.(script(?:_\d+)?)\.value/g)].map((m) => m[1]);
  const unique = [...new Set(keys)];
  assert.deepEqual(unique, Array.from({ length: MAX_CHUNKS }, (_, i) => chunkKey(i + 1)));
});

test("renders the script byte for byte via json chunks, for 1, several and MAX_CHUNKS chunks", () => {
  for (const len of [10, 120, 50 * MAX_CHUNKS]) {
    const script = "var a='xy';".repeat(Math.ceil(len / 11)).slice(0, len);
    const chunks = splitScript(script, 50);
    const html = render(stored(script));
    assert.equal(html, expectedInlineHtml(chunks), `length ${len}`);
  }
});

test("characters that HTML-escape would break (&, <) survive json inline path", () => {
  const script = "var x='a&b<c>';var y=1&&2;";
  const html = render(stored(script));
  assert.match(html, /a&b<c>/);
  assert.doesNotMatch(html, /&amp;/);
  assert.doesNotMatch(html, /&lt;/);
});

test("older installs (only `script`, no parts marker) still render", () => {
  assert.equal(render({ script: "var a=1;" }), expectedInlineHtml(["var a=1;"]));
});

test("a stale chunk above script_parts is ignored", () => {
  const mf = { script: "A", script_parts: 1, script_2: "STALE" };
  assert.equal(render(mf), expectedInlineHtml(["A"]));
});

test("blank metafield renders nothing at all (app off / not synced)", () => {
  assert.equal(render({}), "");
  assert.equal(render({ script: "" }), "");
});

test("inline wrapper is a single script tag without newlines", () => {
  const html = render(stored("var a=1;var b=2;var c=3;var d=4;"));
  assert.doesNotMatch(html, /\n/);
  assert.match(html, /^<script>\(function\(\)\{var __ppS=.*\}\)\(\);<\/script>$/);
});
