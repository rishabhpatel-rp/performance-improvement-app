/**
 * Writes the PagePulse inline script into the merchant theme at the first line
 * of <head> so it runs before content_for_header and other head scripts.
 *
 * Requires `write_themes`. After a successful inject, sets app metafield
 * `pagepulse.theme_head_active` to true so the theme app embed does not double-run.
 */

import { getSelectedThemeId, listThemes } from "./theme-embed.server.js";
import {
  THEME_LAYOUT_FILENAME,
  THEME_SNIPPET_FILENAME,
  patchThemeLayoutHead,
} from "./theme-head-patch.js";
import { readExtensionInlineSnippetLiquid } from "./theme-head-inject-utils.js";

const HEAD_INJECT_ENABLED =
  process.env.PAGEPULSE_THEME_HEAD_INJECT !== "false";

function formatGraphqlErrors(errors: unknown): string {
  if (Array.isArray(errors)) {
    return errors.map((e: { message?: string }) => e.message ?? String(e)).join("; ");
  }
  return typeof errors === "string" ? errors : JSON.stringify(errors);
}

export interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: Array<{ message?: string; field?: string }>;
}

export type AdminGraphQL = {
  graphql: (query: string, variables?: Record<string, unknown>) => Promise<{ json(): Promise<unknown> }>;
};

async function graphqlJson<T = unknown>(
  admin: AdminGraphQL,
  query: string,
  variables?: object,
): Promise<T | undefined> {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json() as GraphQLResponse<T>;
  if (json.errors?.length || (json.errors && !json.data)) {
    throw new Error(formatGraphqlErrors(json.errors));
  }
  return json.data;
}

async function resolveThemeGid(
  admin: AdminGraphQL,
  shopDomain: string,
): Promise<string | null> {
  const selected = await getSelectedThemeId(shopDomain);
  if (selected) return selected;
  const themes = await listThemes(admin);
  const main = themes.find((t) => t.role === "MAIN");
  return main?.id ?? themes[0]?.id ?? null;
}

async function readThemeFile(
  admin: AdminGraphQL,
  themeId: string,
  filename: string,
): Promise<string | null> {
  const data = await graphqlJson<{
    theme?: {
      files?: {
        nodes?: Array<{
          filename: string;
          body?: { content?: string };
        }>;
      };
    };
  }>(
    admin,
    `#graphql
    query ThemeFile($id: ID!, $filenames: [String!]!) {
      theme(id: $id) {
        files(filenames: $filenames) {
          nodes {
            filename
            body {
              ... on OnlineStoreThemeFileBodyText {
                content
              }
            }
          }
        }
      }
    }`,
    { id: themeId, filenames: [filename] },
  );
  const node = data?.theme?.files?.nodes?.[0];
  const content = node?.body?.content;
  return typeof content === "string" ? content : null;
}

async function upsertThemeFiles(
  admin: AdminGraphQL,
  themeId: string,
  files: Array<{ filename: string; body: string }>,
): Promise<void> {
  const data = await graphqlJson<{
    themeFilesUpsert?: {
      upsertedThemeFiles?: Array<{ filename: string }>;
      userErrors?: Array<{ field: string; message: string }>;
    };
  }>(
    admin,
    `#graphql
    mutation ThemeFilesUpsert($themeId: ID!, $files: [OnlineStoreThemeFilesUpsertFileInput!]!) {
      themeFilesUpsert(themeId: $themeId, files: $files) {
        upsertedThemeFiles {
          filename
        }
        userErrors {
          field
          message
        }
      }
    }`,
    {
      themeId,
      files: files.map((f) => ({
        filename: f.filename,
        body: { type: "TEXT", value: f.body },
      })),
    },
  );
  const errors = data?.themeFilesUpsert?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
  }
}

async function setThemeHeadActive(
  admin: AdminGraphQL,
  active: boolean,
): Promise<void> {
  const installData = await graphqlJson<{
    currentAppInstallation?: { id: string };
  }>(
    admin,
    `#graphql
    query CurrentAppInstallation {
      currentAppInstallation {
        id
      }
    }`,
  );
  const ownerId = installData?.currentAppInstallation?.id;
  if (!ownerId) {
    throw new Error("currentAppInstallation not found");
  }
  const data = await graphqlJson<{
    metafieldsSet?: {
      userErrors?: Array<{ field: string; message: string }>;
    };
  }>(
    admin,
    `#graphql
    mutation SetThemeHeadActive($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        userErrors {
          field
          message
        }
      }
    }`,
    {
      metafields: [
        {
          ownerId,
          namespace: "pagepulse",
          key: "theme_head_active",
          type: "boolean",
          value: active ? "true" : "false",
        },
      ],
    },
  );
  const errors = data?.metafieldsSet?.userErrors ?? [];
  if (errors.length) {
    throw new Error(errors.map((e: { message: string }) => e.message).join("; "));
  }
}

export type ThemeHeadInjectResult =
  | { status: "skipped"; reason: string }
  | { status: "injected"; themeId: string }
  | { status: "failed"; reason: string };

/**
 * Ensure the inline script is rendered as the first content inside <head>.
 */
export async function ensureThemeHeadInlineScript(
  admin: AdminGraphQL,
  shopDomain: string,
): Promise<ThemeHeadInjectResult> {
  if (!HEAD_INJECT_ENABLED) {
    return { status: "skipped", reason: "PAGEPULSE_THEME_HEAD_INJECT=false" };
  }

  try {
    const themeId = await resolveThemeGid(admin, shopDomain);
    if (!themeId) {
      return { status: "failed", reason: "no theme id" };
    }

    const layout = await readThemeFile(admin, themeId, THEME_LAYOUT_FILENAME);
    if (!layout) {
      return { status: "failed", reason: "layout/theme.liquid not readable" };
    }

    const snippetBody = readExtensionInlineSnippetLiquid();
    const patchedLayout = patchThemeLayoutHead(layout);

    const files = [{ filename: THEME_SNIPPET_FILENAME, body: snippetBody }];
    if (patchedLayout !== layout) {
      files.push({ filename: THEME_LAYOUT_FILENAME, body: patchedLayout });
    }

    await upsertThemeFiles(admin, themeId, files);
    try {
      await setThemeHeadActive(admin, true);
    } catch (metaErr) {
      console.warn(
        `[theme-head-inject] theme files ok but theme_head_active metafield failed for ${shopDomain}:`,
        metaErr instanceof Error ? metaErr.message : metaErr,
      );
    }

    console.log(
      `[theme-head-inject] head inline ready for ${shopDomain} on theme ${themeId}`,
    );
    return { status: "injected", themeId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[theme-head-inject] failed for ${shopDomain}:`, reason);
    return { status: "failed", reason };
  }
}

/**
 * Re-enable the app embed delivery path (e.g. after uninstall cleanup).
 */
export async function clearThemeHeadDelivery(admin: AdminGraphQL): Promise<void> {
  try {
    await setThemeHeadActive(admin, false);
  } catch (err) {
    console.warn(
      "[theme-head-inject] clearThemeHeadDelivery:",
      err instanceof Error ? err.message : err,
    );
  }
}
