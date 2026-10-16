/**
 * Theme app-embed helpers.
 *
 * App embed blocks stay off until the merchant enables them in the theme
 * editor. We cannot flip that switch ourselves — we deep-link them there,
 * then confirm by reading the theme's config/settings_data.json.
 *
 * The merchant chooses which theme gets the embed (StoreConfig.selectedThemeId).
 * When none is chosen we fall back to the live (MAIN) theme.
 *
 * @see https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
 */

import prisma from "../db.server";

export const APP_EMBED_HANDLE = "performance-loader";

// Roles a merchant can sensibly install into. DEVELOPMENT (temporary CLI
// themes), ARCHIVED and LOCKED (cannot be customised) are hidden.
const SELECTABLE_THEME_ROLES = new Set(["MAIN", "UNPUBLISHED", "DEMO"]);

async function graphqlJson(admin, query, variables) {
  const res = await admin.graphql(query, variables ? { variables } : undefined);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(
      json.errors.map((e) => e.message).join("; "),
    );
  }
  return json.data;
}

/**
 * "gid://shopify/OnlineStoreTheme/123" -> "123"
 * @param {string | null | undefined} gid
 * @returns {string}
 */
export function numericThemeId(gid) {
  return String(gid || "").split("/").pop() || "";
}

/**
 * Themes the merchant can pick for the app extension: live theme first, then
 * the rest by most recently edited.
 *
 * @param {any} admin
 * @returns {Promise<Array<{id: string, numericId: string, name: string, role: string, updatedAt: string}>>}
 */
export async function listThemes(admin) {
  const data = await graphqlJson(
    admin,
    `#graphql
    query StoreThemes {
      themes(first: 50) {
        nodes {
          id
          name
          role
          updatedAt
        }
      }
    }`,
  );
  const nodes = data.themes?.nodes ?? [];
  return nodes
    .filter((t) => SELECTABLE_THEME_ROLES.has(t.role))
    .sort((a, b) => {
      if (a.role === "MAIN") return -1;
      if (b.role === "MAIN") return 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    })
    .map((t) => ({ ...t, numericId: numericThemeId(t.id) }));
}

/**
 * The theme the merchant picked for the extension, or null (= live theme).
 *
 * @param {string} shopDomain
 * @returns {Promise<string | null>}
 */
export async function getSelectedThemeId(shopDomain) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: { configs: { select: { selectedThemeId: true } } },
  });
  return store?.configs?.[0]?.selectedThemeId ?? null;
}

/**
 * Deep link that opens the theme editor App embeds panel with this app's
 * embed selected so the merchant can turn it on.
 *
 * @param {string} shop - e.g. "example.myshopify.com"
 * @param {string} [apiKey]
 * @param {string} [handle]
 * @param {string | null} [themeId] - theme GID; omitted = the live theme
 * @returns {string}
 */
export function getAppEmbedDeepLink(
  shop,
  apiKey = process.env.SHOPIFY_API_KEY || "",
  handle = APP_EMBED_HANDLE,
  themeId = null,
) {
  const store = String(shop).replace(/\.myshopify\.com$/i, "");
  const theme = (themeId && numericThemeId(themeId)) || "current";
  return `https://admin.shopify.com/store/${store}/themes/${theme}/editor?context=apps&activateAppId=${apiKey}/${handle}`;
}

/**
 * True when the chosen theme (or the live theme when `themeId` is empty) has
 * this app embed enabled. Returns null when the check could not run.
 *
 * @param {any} admin
 * @param {string} [handle]
 * @param {string | null} [themeId] - theme GID; omitted = the live theme
 * @returns {Promise<boolean|null>}
 */
export async function isAppEmbedEnabled(
  admin,
  handle = APP_EMBED_HANDLE,
  themeId = null,
) {
  try {
    let theme;
    if (themeId) {
      const themeData = await graphqlJson(
        admin,
        `#graphql
        query ThemeEmbed($id: ID!) {
          theme(id: $id) {
            id
            role
            files(filenames: ["config/settings_data.json"]) {
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
        { id: themeId },
      );
      theme = themeData.theme;
    } else {
      const themeData = await graphqlJson(
        admin,
        `#graphql
        query MainThemeSettings {
          themes(first: 1, roles: [MAIN]) {
            nodes {
              id
              files(filenames: ["config/settings_data.json"]) {
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
          }
        }`,
      );
      theme = themeData.themes?.nodes?.[0];
    }
    if (!theme?.id) return false;

    const content = theme.files?.nodes?.[0]?.body?.content || "";
    return embedEnabledInSettings(content, handle);
  } catch (err) {
    if (err instanceof Response) throw err;
    console.warn(
      "[theme-embed] Failed to read embed status:",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

/**
 * An embed is present in settings_data.json only after it has been enabled
 * at least once. If later disabled, it stays in the file with disabled:true.
 */
export function embedEnabledInSettings(content, handle = APP_EMBED_HANDLE) {
  if (!content || typeof content !== "string") return false;
  const needle = `/blocks/${handle}/`;
  const idx = content.indexOf(needle);
  if (idx === -1) return false;
  const snippet = content.slice(idx, idx + 500);
  const disabled = snippet.match(/"disabled"\s*:\s*(true|false)/);
  if (disabled && disabled[1] === "true") return false;
  return true;
}
