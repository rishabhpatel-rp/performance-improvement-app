/**
 * Theme app-embed helpers.
 *
 * App embed blocks stay off until the merchant enables them in the theme
 * editor. We cannot flip that switch ourselves — we deep-link them there,
 * then confirm by reading the published theme's config/settings_data.json.
 *
 * @see https://shopify.dev/docs/apps/build/online-store/theme-app-extensions/configuration
 */

export const APP_EMBED_HANDLE = "performance-loader";

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
 * Deep link that opens the theme editor App embeds panel with this app's
 * embed selected so the merchant can turn it on.
 *
 * @param {string} shop - e.g. "example.myshopify.com"
 * @param {string} [apiKey]
 * @param {string} [handle]
 * @returns {string}
 */
export function getAppEmbedDeepLink(
  shop,
  apiKey = process.env.SHOPIFY_API_KEY || "",
  handle = APP_EMBED_HANDLE,
) {
  const store = String(shop).replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${store}/themes/current/editor?context=apps&activateAppId=${apiKey}/${handle}`;
}

/**
 * True when the published theme has this app embed enabled.
 * Returns null when the check could not run (do not block the merchant).
 *
 * @param {any} admin
 * @param {string} [handle]
 * @returns {Promise<boolean|null>}
 */
export async function isAppEmbedEnabled(admin, handle = APP_EMBED_HANDLE) {
  try {
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
    const theme = themeData.themes?.nodes?.[0];
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
