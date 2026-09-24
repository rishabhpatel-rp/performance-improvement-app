import { authenticate } from "../shopify.server";
import { listThemes, getSelectedThemeId } from "../lib/theme-embed.server";
import {
  withShopifyTimeout,
  rethrowAuthRedirect,
} from "../lib/shopify-timeout.server";

/**
 * GET /api/themes
 * Themes the merchant can install the app extension in (live first), plus the
 * currently selected one. Fetched by the Step 1 picker on mount so the main
 * dashboard loader does not pay for an extra Admin API call.
 */
export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  try {
    const [themes, selectedThemeId] = await Promise.all([
      withShopifyTimeout(listThemes(admin), "listThemes"),
      getSelectedThemeId(session.shop),
    ]);
    return {
      ok: true,
      themes,
      selectedThemeId,
      liveThemeId: themes.find((t) => t.role === "MAIN")?.id ?? null,
    };
  } catch (err) {
    rethrowAuthRedirect(err);
    console.error(
      "[api.themes] Failed to load themes:",
      err instanceof Error ? err.message : err,
    );
    return {
      ok: false,
      themes: [],
      selectedThemeId: null,
      liveThemeId: null,
      error: "Couldn't load themes",
    };
  }
};
