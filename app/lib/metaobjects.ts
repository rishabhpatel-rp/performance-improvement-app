import { authenticate } from '../shopify.server';
import type { ScriptMetaobject, ScriptInput, GlobalConfig, GlobalConfigInput, ScriptsConnection } from '../types/script';
import type { AppSession } from '@shopify/shopify-app-react-router';

const SCRIPT_TYPE = 'script_injector_script';
const CONFIG_TYPE = 'script_injector_config';

const SCRIPT_TYPE = 'script_injector_script';
const CONFIG_TYPE = 'script_injector_config';

const SCRIPT_FRAGMENT = `
  fragment ScriptFields on Metaobject {
    id
    handle
    type
    fields {
      key
      value
    }
    createdAt
    updatedAt
  }
`;

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

function mapScriptFields(fields: Array<{ key: string; value: string }>): Partial<ScriptMetaobject> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.key] = field.value;
  }
  return {
    name: result.name as string,
    code: result.code as string,
    enabled: result.enabled === 'true',
    targetPages: (result.targetPages as string)?.split(',').filter(Boolean) || [],
    customPageHandles: (result.customPageHandles as string)?.split(',').filter(Boolean) || [],
    position: (result.position as 'head' | 'body_start' | 'body_end') || 'head',
    priority: parseInt(result.priority as string, 10) || 0,
    async: result.async === 'true',
    defer: result.defer !== 'false',
  };
}

function mapConfigFields(fields: Array<{ key: string; value: string }>): GlobalConfig {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    result[field.key] = field.value;
  }
  return {
    autoInject: result.auto_inject === 'true',
    debugMode: result.debug_mode === 'true',
  };
}

export async function getScripts(session: AppSession): Promise<ScriptMetaobject[]> {
  const { admin } = await authenticate.admin(session);
  const response = await admin.graphql(
    `#graphql
    query GetScripts($first: Int!) {
      metaobjects(first: $first, type: "${SCRIPT_TYPE}") {
        edges {
          node {
            ...ScriptFields
          }
        }
        pageInfo {
          hasNextPage
          hasPreviousPage
          startCursor
          endCursor
        }
      }
    }
    ${SCRIPT_FRAGMENT}
    `,
    { variables: { first: 100 } }
  );

  const data = await response.json();
  const connection = data.data?.metaobjects as ScriptsConnection;
  if (!connection) return [];

  return connection.edges.map((edge) => ({
    id: edge.node.id,
    handle: edge.node.handle,
    createdAt: edge.node.createdAt,
    updatedAt: edge.node.updatedAt,
    ...mapScriptFields(edge.node.fields),
  })) as ScriptMetaobject[];
}

export async function getScript(session: AppSession, id: string): Promise<ScriptMetaobject | null> {
  const { admin } = await authenticate.admin(session);
  const response = await admin.graphql(
    `#graphql
    query GetScript($id: ID!) {
      metaobject(id: $id) {
        ...ScriptFields
      }
    }
    ${SCRIPT_FRAGMENT}
    `,
    { variables: { id } }
  );

  const data = await response.json();
  const node = data.data?.metaobject;
  if (!node) return null;

  return {
    id: node.id,
    handle: node.handle,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...mapScriptFields(node.fields),
  } as ScriptMetaobject;
}

export async function createScript(session: AppSession, input: ScriptInput): Promise<ScriptMetaobject> {
  const { admin } = await authenticate.admin(session);

  const fields = [
    { key: 'name', value: input.name },
    { key: 'code', value: input.code },
    { key: 'enabled', value: String(input.enabled ?? true) },
    { key: 'target_pages', value: input.targetPages?.join(',') || '' },
    { key: 'custom_page_handles', value: input.customPageHandles?.join(',') || '' },
    { key: 'position', value: input.position || 'head' },
    { key: 'priority', value: String(input.priority ?? 0) },
    { key: 'async', value: String(input.async ?? false) },
    { key: 'defer', value: String(input.defer ?? true) },
  ];

  const response = await admin.graphql(
    `#graphql
    mutation CreateScript($metaobject: MetaobjectCreateInput!) {
      metaobjectCreate(metaobject: $metaobject) {
        metaobject {
          ...ScriptFields
        }
        userErrors {
          field
          message
        }
      }
    }
    ${SCRIPT_FRAGMENT}
    `,
    {
      variables: {
        metaobject: {
          type: SCRIPT_TYPE,
          fields,
        },
      },
    }
  );

  const data = await response.json();
  const result = data.data?.metaobjectCreate;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e: { message: string }) => e.message).join(', '));
  }

  const node = result?.metaobject;
  return {
    id: node.id,
    handle: node.handle,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...mapScriptFields(node.fields),
  } as ScriptMetaobject;
}

export async function updateScript(session: AppSession, id: string, input: Partial<ScriptInput>): Promise<ScriptMetaobject> {
  const { admin } = await authenticate.admin(session);

  const fields: Array<{ key: string; value: string }> = [];
  if (input.name !== undefined) fields.push({ key: 'name', value: input.name });
  if (input.code !== undefined) fields.push({ key: 'code', value: input.code });
  if (input.enabled !== undefined) fields.push({ key: 'enabled', value: String(input.enabled) });
  if (input.targetPages !== undefined) fields.push({ key: 'target_pages', value: input.targetPages.join(',') });
  if (input.customPageHandles !== undefined) fields.push({ key: 'custom_page_handles', value: input.customPageHandles.join(',') });
  if (input.position !== undefined) fields.push({ key: 'position', value: input.position });
  if (input.priority !== undefined) fields.push({ key: 'priority', value: String(input.priority) });
  if (input.async !== undefined) fields.push({ key: 'async', value: String(input.async) });
  if (input.defer !== undefined) fields.push({ key: 'defer', value: String(input.defer) });

  const response = await admin.graphql(
    `#graphql
    mutation UpdateScript($id: ID!, $metaobject: MetaobjectUpdateInput!) {
      metaobjectUpdate(id: $id, metaobject: $metaobject) {
        metaobject {
          ...ScriptFields
        }
        userErrors {
          field
          message
        }
      }
    }
    ${SCRIPT_FRAGMENT}
    `,
    {
      variables: {
        id,
        metaobject: { fields },
      },
    }
  );

  const data = await response.json();
  const result = data.data?.metaobjectUpdate;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e: { message: string }) => e.message).join(', '));
  }

  const node = result?.metaobject;
  return {
    id: node.id,
    handle: node.handle,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
    ...mapScriptFields(node.fields),
  } as ScriptMetaobject;
}

export async function deleteScript(session: AppSession, id: string): Promise<void> {
  const { admin } = await authenticate.admin(session);
  const response = await admin.graphql(
    `#graphql
    mutation DeleteScript($id: ID!) {
      metaobjectDelete(id: $id) {
        deletedId
        userErrors {
          field
          message
        }
      }
    }
    `,
    { variables: { id } }
  );

  const data = await response.json();
  const result = data.data?.metaobjectDelete;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e: { message: string }) => e.message).join(', '));
  }
}

export async function reorderScripts(session: AppSession, scriptIds: string[]): Promise<void> {
  for (let i = 0; i < scriptIds.length; i++) {
    await updateScript(session, scriptIds[i], { priority: i });
  }
}

export async function getGlobalConfig(session: unknown): Promise<GlobalConfig> {
  const { admin } = await authenticate.admin(session);
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
    `
  );

  const data = await response.json();
  const edge = data.data?.metaobjects?.edges?.[0];
  if (!edge?.node) {
    return { autoInject: false, debugMode: false };
  }

  return mapConfigFields(edge.node.fields);
}

export async function updateGlobalConfig(session: unknown, input: GlobalConfigInput): Promise<GlobalConfig> {
  const { admin } = await authenticate.admin(session);

  const fields: Array<{ key: string; value: string }> = [];
  if (input.autoInject !== undefined) fields.push({ key: 'auto_inject', value: String(input.autoInject) });
  if (input.debugMode !== undefined) fields.push({ key: 'debug_mode', value: String(input.debugMode) });

  let configId: string | undefined;
  const existing = await admin.graphql(
    `#graphql
    query GetConfigId {
      metaobjects(first: 1, type: "${CONFIG_TYPE}") {
        edges {
          node {
            id
          }
        }
      }
    }
    `
  );
  const existingData = await existing.json();
  configId = existingData.data?.metaobjects?.edges?.[0]?.node?.id;

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
      { variables: { id: configId, metaobject: { fields } } }
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
      { variables: { metaobject: { type: CONFIG_TYPE, fields } } }
    );
  }

  const data = await response.json();
  const result = data.data?.metaobjectUpdate ?? data.data?.metaobjectCreate;
  if (result?.userErrors?.length) {
    throw new Error(result.userErrors.map((e: { message: string }) => e.message).join(', '));
  }

  return mapConfigFields(result.metaobject.fields);
}

export async function deleteAllScriptsForShop(session: unknown): Promise<void> {
  const scripts = await getScripts(session);
  for (const script of scripts) {
    await deleteScript(session, script.id);
  }
}

export async function deleteGlobalConfig(session: unknown): Promise<void> {
  const { admin } = await authenticate.admin(session);
  const response = await admin.graphql(
    `#graphql
    query GetConfigId {
      metaobjects(first: 1, type: "${CONFIG_TYPE}") {
        edges {
          node {
            id
          }
        }
      }
    }
    `
  );
  const data = await response.json();
  const configId = data.data?.metaobjects?.edges?.[0]?.node?.id;
  if (configId) {
    await admin.graphql(
      `#graphql
      mutation DeleteConfig($id: ID!) {
        metaobjectDelete(id: $id) {
          deletedId
        }
      }
      `,
      { variables: { id: configId } }
    );
  }
}