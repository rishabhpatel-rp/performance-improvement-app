// Inline-script helpers: everything that does NOT touch the database or the
// Shopify session, so it can be unit-tested with plain `node --test`.
//
// The storefront script is mirrored into app-reserved shop metafields and
// rendered INLINE by the theme app embed
// (extensions/script-injector/blocks/performance-loader.liquid), whose target is
// `compliance_head` (rendered first in <head>). There is NO <script src>
// fallback: when the metafields are blank the embed prints nothing.
//
// Shopify caps a text metafield at about 65,535 characters, so the script is
// stored in up to MAX_CHUNKS metafields (`script`, `script_2` ... `script_6`)
// plus `script_parts` (how many chunks are valid). The Liquid concatenates them
// byte for byte.
//
// The string stored is the already-obfuscated `PerformanceScript.deferScript`.
// It is never re-obfuscated here.

import { createHash } from "node:crypto";

/** Max characters per metafield chunk (Shopify limit is ~65,535). */
export const CHUNK_CHARS = 60_000;
/** The Liquid block reads exactly this many chunks. Keep it in step with the .liquid file. */
export const MAX_CHUNKS = 6;
/** Inline only when the script fits in MAX_CHUNKS chunks. Measured in characters. */
export const INLINE_CAPACITY_CHARS = CHUNK_CHARS * MAX_CHUNKS;

// `$app:` is Shopify's app-reserved namespace: no extra access scope needed and
// Liquid reads shop-owned values as `shop.metafields["$app:pagepulse"].script` (see
// performance-loader.liquid); `app.metafields.pagepulse` is kept as a fallback only.
export const METAFIELD_NAMESPACE = "$app:pagepulse";
export const METAFIELD_KEY = "script";
export const METAFIELD_TYPE = "multi_line_text_field";
export const METAFIELD_PARTS_KEY = "script_parts";
export const METAFIELD_PARTS_TYPE = "number_integer";

/**
 * Metafield key of chunk `n` (1-based): `script`, `script_2`, ... `script_6`.
 * @param {number} n
 */
export function chunkKey(n) {
  return n <= 1 ? METAFIELD_KEY : `${METAFIELD_KEY}_${n}`;
}

/** Every key this feature owns (all chunks plus the parts marker). */
export function allMetafieldKeys() {
  return [
    ...Array.from({ length: MAX_CHUNKS }, (_, i) => chunkKey(i + 1)),
    METAFIELD_PARTS_KEY,
  ];
}

/** A cut between s[i-1] and s[i] is safe when it is not next to whitespace nor inside a surrogate pair. */
function isSafeCut(s, i) {
  if (/\s/.test(s[i - 1]) || /\s/.test(s[i])) return false;
  const a = s.charCodeAt(i - 1);
  const b = s.charCodeAt(i);
  return !(a >= 0xd800 && a <= 0xdbff && b >= 0xdc00 && b <= 0xdfff);
}

/**
 * Split the script into chunks of at most `size` characters. Joining the chunks
 * gives back the exact input. Cuts avoid whitespace (a store could trim it) and
 * surrogate pairs.
 *
 * @param {string} script
 * @param {number} [size]
 * @returns {string[]}
 */
export function splitScript(script, size = CHUNK_CHARS) {
  const s = typeof script === "string" ? script : "";
  const chunks = [];
  let pos = 0;
  while (pos < s.length) {
    let end = Math.min(pos + size, s.length);
    if (end < s.length) {
      let cut = end;
      while (cut > pos + 1 && !isSafeCut(s, cut)) cut--;
      if (isSafeCut(s, cut)) end = cut;
    }
    chunks.push(s.slice(pos, end));
    pos = end;
  }
  return chunks;
}

/**
 * An inline <script> ends at the first `</script`, and `<!--` can switch the
 * HTML parser into the script-data-escaped state. Neither can appear in the
 * generator's output today; this guards against it ever happening silently.
 *
 * @param {unknown} code
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function isSafeForInline(code) {
  if (typeof code !== "string" || code.length === 0) {
    return { ok: false, reason: "empty script" };
  }
  if (/<\/script/i.test(code)) {
    return { ok: false, reason: "contains </script" };
  }
  if (code.includes("<!--")) {
    return { ok: false, reason: "contains <!--" };
  }
  return { ok: true };
}

/**
 * Stable per-shop 32-bit seed for the obfuscator, so identical input gives
 * identical output. Never 0 (the obfuscator treats 0 as "random").
 *
 * @param {string} shopDomain
 * @returns {number}
 */
export function seedFromShop(shopDomain) {
  const hex = createHash("sha256").update(String(shopDomain)).digest("hex").slice(0, 8);
  const n = parseInt(hex, 16) >>> 0;
  return n === 0 ? 1 : n;
}

/** @param {string} script */
export function hashScript(script) {
  return createHash("sha256").update(script).digest("hex");
}

/**
 * Decide what the metafield should do for the current stored script.
 *
 * `script` must already be "" when the app is off / the store is inactive:
 * an inline script has no per-request on/off check, so "off" has to be pushed
 * out by clearing the metafields (the Liquid then prints nothing).
 *
 * @param {{script?: string|null, scriptHash?: string|null, metafieldHash?: string|null}} input
 * @returns {{action: "write", hash: string}
 *   | {action: "clear", reason: string}
 *   | {action: "noop", reason: string}}
 */
export function planMetafieldSync({ script, scriptHash, metafieldHash }) {
  const s = typeof script === "string" ? script : "";
  const live = metafieldHash || null;

  /** @type {string} */
  let reason = "";
  /** @type {string|null} */
  let desired = null;

  if (!s) {
    reason = "no script (app off or not built)";
  } else if (s.length > INLINE_CAPACITY_CHARS) {
    reason = `script over ${INLINE_CAPACITY_CHARS} characters; cannot be inlined`;
  } else {
    const safe = isSafeForInline(s);
    if (safe.ok) {
      desired = scriptHash || hashScript(s);
    } else {
      reason = safe.reason;
    }
  }

  if (desired) {
    return desired === live
      ? { action: "noop", reason: "metafield already current" }
      : { action: "write", hash: desired };
  }
  return live
    ? { action: "clear", reason }
    : { action: "noop", reason: reason || "nothing to clear" };
}

// ---------------------------------------------------------------------------
// Admin GraphQL operations. `admin` is any object with `graphql(query, {variables})`
// returning a fetch-like Response (the shape the Shopify app library provides),
// so tests can pass a fake.
// ---------------------------------------------------------------------------

async function run(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json();
  if (json.errors?.length) {
    const msg = Array.isArray(json.errors)
      ? json.errors.map((e) => e.message).join("; ")
      : String(json.errors);
    throw new Error(msg);
  }
  return json.data;
}

function throwUserErrors(errors, label) {
  if (errors?.length) {
    throw new Error(`${label}: ${errors.map((e) => e.message).join("; ")}`);
  }
}

/** @param {any} admin */
export async function getShopGid(admin) {
  const data = await run(admin, `#graphql\nquery PagePulseShopId { shop { id } }`);
  const id = data?.shop?.id;
  if (!id) throw new Error("could not read shop id");
  return id;
}

/**
 * Best-effort: a typed definition makes the value visible/identifiable in the
 * admin. Storefront Liquid reads these via `shop.metafields["$app:pagepulse"]`,
 * which requires `access.storefront: PUBLIC_READ` on the definition.
 *
 * @param {any} admin
 */
export async function ensureScriptDefinition(admin) {
  const defs = [
    ...Array.from({ length: MAX_CHUNKS }, (_, i) => ({
      key: chunkKey(i + 1),
      type: METAFIELD_TYPE,
      name: `PagePulse inline script (part ${i + 1})`,
    })),
    { key: METAFIELD_PARTS_KEY, type: METAFIELD_PARTS_TYPE, name: "PagePulse inline script parts" },
  ];
  const access = { storefront: "PUBLIC_READ" };
  for (const d of defs) {
    const base = {
      name: d.name,
      namespace: METAFIELD_NAMESPACE,
      key: d.key,
      type: d.type,
      ownerType: "SHOP",
      description: "Generated storefront script rendered inline by the PagePulse app embed.",
      access,
    };
    try {
      await run(
        admin,
        `#graphql
        mutation PagePulseDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id }
            userErrors { field message code }
          }
        }`,
        { definition: base },
      );
    } catch {
      // non-fatal by design
    }
    try {
      const data = await run(
        admin,
        `#graphql
        mutation PagePulseDefinitionUpdate($definition: MetafieldDefinitionUpdateInput!) {
          metafieldDefinitionUpdate(definition: $definition) {
            updatedDefinition { id }
            userErrors { field message code }
          }
        }`,
        {
          definition: {
            namespace: METAFIELD_NAMESPACE,
            key: d.key,
            ownerType: "SHOP",
            access,
          },
        },
      );
      throwUserErrors(data?.metafieldDefinitionUpdate?.userErrors, "metafieldDefinitionUpdate");
    } catch {
      // non-fatal: definition may not exist yet on first install
    }
  }
}

/**
 * Writes every chunk plus `script_parts` in ONE metafieldsSet call, so a shopper
 * never sees a half-written script. Chunks above `script_parts` from an older,
 * longer script are ignored by the Liquid, so they need no cleanup.
 *
 * @param {any} admin
 * @param {string} script already-obfuscated JavaScript
 */
export async function writeScriptMetafield(admin, script) {
  const chunks = splitScript(script);
  if (chunks.length === 0) throw new Error("writeScriptMetafield: empty script");
  if (chunks.length > MAX_CHUNKS) {
    throw new Error(
      `writeScriptMetafield: script needs ${chunks.length} chunks, max is ${MAX_CHUNKS}`,
    );
  }
  const ownerId = await getShopGid(admin);
  const metafields = [
    ...chunks.map((value, i) => ({
      ownerId,
      namespace: METAFIELD_NAMESPACE,
      key: chunkKey(i + 1),
      type: METAFIELD_TYPE,
      value,
    })),
    {
      ownerId,
      namespace: METAFIELD_NAMESPACE,
      key: METAFIELD_PARTS_KEY,
      type: METAFIELD_PARTS_TYPE,
      value: String(chunks.length),
    },
  ];
  const data = await run(
    admin,
    `#graphql
    mutation PagePulseSetScript($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id }
        userErrors { field message code }
      }
    }`,
    { metafields },
  );
  throwUserErrors(data?.metafieldsSet?.userErrors, "metafieldsSet");
}

/** Removes every chunk and the parts marker in one call. @param {any} admin */
export async function deleteScriptMetafield(admin) {
  const ownerId = await getShopGid(admin);
  const data = await run(
    admin,
    `#graphql
    mutation PagePulseDeleteScript($metafields: [MetafieldIdentifierInput!]!) {
      metafieldsDelete(metafields: $metafields) {
        deletedMetafields { key namespace ownerId }
        userErrors { field message }
      }
    }`,
    {
      metafields: allMetafieldKeys().map((key) => ({
        ownerId,
        namespace: METAFIELD_NAMESPACE,
        key,
      })),
    },
  );
  throwUserErrors(data?.metafieldsDelete?.userErrors, "metafieldsDelete");
}
