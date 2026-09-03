import { authenticate } from "../shopify.server";
import type { AppConfig, AppConfigInput } from "../types/script";

// The metaobject is declared in shopify.app.toml under
// [metaobjects.app.script_injector_config], which Shopify namespaces with the
// reserved `$app:` prefix at runtime. Without this prefix the Admin API can't
// find the type and every read/write silently returns nothing.
const CONFIG_TYPE = "$app:script_injector_config";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;
// Accept either a request that still needs `authenticate.admin`, or an
// already-resolved admin GraphQL client (e.g. the `admin` returned from
// `authenticate.webhook`, which has no session token to re-authenticate).
type RequestOrAdmin = Request | AdminClient;

async function resolveAdmin(
  requestOrAdmin: RequestOrAdmin,
): Promise<AdminClient> {
  if (
    requestOrAdmin &&
    typeof (requestOrAdmin as AdminClient).graphql === "function"
  ) {
    return requestOrAdmin as AdminClient;
  }
  const { admin } = await authenticate.admin(requestOrAdmin as Request);
  return admin;
}

const CONFIG_FRAGMENT = `
  fragment ConfigFields on Metaobject {
    id
    handle
    type
    fields {
      key
      value
    }
  }
`;

function parseTitles(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw !== "string" || !raw) return ["", "", ""];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : ["", "", ""];
  } catch {
    return ["", "", ""];
  }
}

// parseJsonArray: parses a JSON-encoded array string (e.g. a list field) into a
// string[]. Falls back to [] so a missing/blank field never crashes the app.
function parseJsonArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw !== "string" || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? ((parsed as unknown[]) as string[]) : [];
  } catch {
    return [];
  }
}

function mapConfigFields(
  fields: Array<{ key: string; value: string }>,
): AppConfig {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.key] = field.value;
  }
  return {
    appEnabled: result.app_enabled === "true",
    script1Enabled: result.script_1_enabled === "true",
    script2Enabled: result.script_2_enabled === "true",
    script3Enabled: result.script_3_enabled === "true",
    scriptTitles: parseTitles(result.script_titles),
    debugMode: result.debug_mode === "true",
    auditDeferArray: parseJsonArray(result.audit_defer_array),
    auditHideSelectors: parseJsonArray(result.audit_hide_selectors),
    auditComplete: result.audit_complete === "true",
    appEndpoint: typeof result.app_endpoint === "string" ? result.app_endpoint : "",
  };
}

// DEFAULT_APP_CONFIG: shared shape used by the loader/actions and by
// ensureConfig when the metaobject definition isn't deployed yet.
export function defaultAppConfig(): AppConfig {
  return {
    appEnabled: false,
    script1Enabled: false,
    script2Enabled: false,
    script3Enabled: false,
    scriptTitles: ["", "", ""],
    debugMode: false,
    auditDeferArray: [],
    auditHideSelectors: [],
    auditComplete: false,
    appEndpoint: "",
  };
}

function buildFields(
  input: AppConfigInput,
): Array<{ key: string; value: string }> {
  const fields: Array<{ key: string; value: string }> = [];
  if (input.appEnabled !== undefined)
    fields.push({ key: "app_enabled", value: String(input.appEnabled) });
  if (input.script1Enabled !== undefined)
    fields.push({
      key: "script_1_enabled",
      value: String(input.script1Enabled),
    });
  if (input.script2Enabled !== undefined)
    fields.push({
      key: "script_2_enabled",
      value: String(input.script2Enabled),
    });
  if (input.script3Enabled !== undefined)
    fields.push({
      key: "script_3_enabled",
      value: String(input.script3Enabled),
    });
  // list.single_line_text_field values are written as a JSON-encoded array
  // string. Blank entries are rejected by Shopify validation ("Value can't be
  // blank"), so drop empty strings and store an empty array when there are none.
  if (input.scriptTitles !== undefined) {
    const nonBlank = (input.scriptTitles ?? []).filter(
      (t) => t && t.trim() !== "",
    );
    fields.push({ key: "script_titles", value: JSON.stringify(nonBlank) });
  }
  if (input.debugMode !== undefined)
    fields.push({ key: "debug_mode", value: String(input.debugMode) });
  if (input.auditDeferArray !== undefined)
    fields.push({
      key: "audit_defer_array",
      value: JSON.stringify(input.auditDeferArray),
    });
  if (input.auditHideSelectors !== undefined)
    fields.push({
      key: "audit_hide_selectors",
      value: JSON.stringify(input.auditHideSelectors),
    });
  if (input.auditComplete !== undefined)
    fields.push({
      key: "audit_complete",
      value: String(input.auditComplete),
    });
  if (input.appEndpoint !== undefined)
    fields.push({ key: "app_endpoint", value: input.appEndpoint });
  return fields;
}

async function findConfigId(admin: AdminClient): Promise<string | undefined> {
  const response = await admin.graphql(
    `#graphql
    query GetConfigId {
      metaobjects(first: 1, type: "${CONFIG_TYPE}") {
        edges {
          node { id }
        }
      }
    }
    `,
  );
  const data = await response.json();
  return data.data?.metaobjects?.edges?.[0]?.node?.id;
}

export async function getConfig(request: RequestOrAdmin): Promise<AppConfig> {
  const admin = await resolveAdmin(request);
  const response = await admin.graphql(
    `#graphql
    query GetConfig {
      metaobjects(first: 1, type: "${CONFIG_TYPE}") {
        edges {
          node {
            ...ConfigFields
          }
        }
      }
    }
    ${CONFIG_FRAGMENT}
    `,
  );

  const data = await response.json();
  const edge = data.data?.metaobjects?.edges?.[0];
  if (!edge?.node) {
    return defaultAppConfig();
  }

  return mapConfigFields(edge.node.fields);
}

/**
 * Partial update — save a single toggle, a single field, or several at once.
 * Creates the config metaobject if it doesn't exist yet.
 */
export async function updateConfig(
  request: RequestOrAdmin,
  input: AppConfigInput,
): Promise<AppConfig> {
  const admin = await resolveAdmin(request);
  const fields = buildFields(input);
  const configId = await findConfigId(admin);

  let response;
  if (configId) {
    response = await admin.graphql(
      `#graphql
      mutation UpdateConfig($id: ID!, $metaobject: MetaobjectUpdateInput!) {
        metaobjectUpdate(id: $id, metaobject: $metaobject) {
          metaobject {
            ...ConfigFields
          }
          userErrors {
            field
            message
          }
        }
      }
      ${CONFIG_FRAGMENT}
      `,
      { variables: { id: configId, metaobject: { fields } } },
    );
  } else {
    response = await admin.graphql(
      `#graphql
      mutation CreateConfig($metaobject: MetaobjectCreateInput!) {
        metaobjectCreate(metaobject: $metaobject) {
          metaobject {
            ...ConfigFields
          }
          userErrors {
            field
            message
          }
        }
      }
      ${CONFIG_FRAGMENT}
      `,
      { variables: { metaobject: { type: CONFIG_TYPE, fields } } },
    );
  }

  const data = await response.json();
  const result = data.data?.metaobjectUpdate ?? data.data?.metaobjectCreate;
  if (result?.userErrors?.length) {
    throw new Error(
      result.userErrors.map((e: { message: string }) => e.message).join(", "),
    );
  }

  return mapConfigFields(result.metaobject.fields);
}

/**
 * Ensure a config metaobject exists for the shop (onboarding). Returns the
 * config plus whether it was just created (first install / first visit).
 */
export async function ensureConfig(
  requestOrAdmin: RequestOrAdmin,
): Promise<{ config: AppConfig; created: boolean }> {
  const admin = await resolveAdmin(requestOrAdmin);
  const configId = await findConfigId(admin);
  if (configId) {
    return { config: await getConfig(admin), created: false };
  }

  // The metaobject type may not exist yet if `shopify app config push`
  // hasn't been run. Return defaults instead of crashing.
  try {
    const config = await updateConfig(admin, {
      appEnabled: false,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      scriptTitles: ["", "", ""],
      debugMode: false,
    });
    return { config, created: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No metaobject definition exists")) {
      console.warn(
        "[ensureConfig] Metaobject definition not deployed yet. " +
          "Run `shopify app config push` to create it. " +
          "Returning defaults for now.",
      );
      return { config: defaultAppConfig(), created: false };
    }
    throw err;
  }
}

export async function deleteConfig(request: RequestOrAdmin): Promise<void> {
  const admin = await resolveAdmin(request);
  const configId = await findConfigId(admin);
  if (configId) {
    await admin.graphql(
      `#graphql
      mutation DeleteConfig($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
        }
      }
      `,
      { variables: { id: configId } },
    );
  }
}

/**
 * Ensure the config metaobject's `app_endpoint` field matches the public
 * /audit-submit URL derived from SHOPIFY_APP_URL. Called on every dashboard
 * load so the storefront audit script can POST results back without manual
 * editing. Returns the full merged config so callers can spread it over the
 * loaded config. Non-fatal: if the metaobject/field isn't deployed yet, it
 * returns the current config unchanged (defaults included).
 */
export async function ensureAppEndpoint(
  requestOrAdmin: RequestOrAdmin,
  endpoint: string,
): Promise<AppConfig> {
  const admin = await resolveAdmin(requestOrAdmin);
  try {
    const config = await getConfig(admin);
    if (config.appEndpoint === endpoint) {
      return config;
    }
    return await updateConfig(admin, { appEndpoint: endpoint });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      "[ensureAppEndpoint] Could not sync app_endpoint:",
      message,
      "Using defaults.",
    );
    return defaultAppConfig();
  }
}

/**
 * Reset the audit state so a fresh one-time audit can run on the next
 * OFF->ON cycle. Sets audit_complete=false and clears both audit arrays.
 * Non-fatal — swaps any failure, so it never breaks the dashboard toggle.
 */
export async function resetAudit(
  requestOrAdmin: RequestOrAdmin,
): Promise<AppConfig> {
  const admin = await resolveAdmin(requestOrAdmin);
  try {
    return await updateConfig(admin, {
      auditDeferArray: [],
      auditHideSelectors: [],
      auditComplete: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[resetAudit] Could not reset audit state:", message);
    return defaultAppConfig();
  }
}
