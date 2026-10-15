import prisma from "../db.server";
import {
  listThemes,
} from "./theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
} from "./theme-embed.server";
import { disableAppBecauseEmbedOff } from "./dashboard-helpers.server.js";
import { safeLogActivity } from "./dashboard-helpers.server.js";

export async function handleRetryHeadInject({ admin, session }) {
const { attemptThemeHeadInject } = await import(
  "./theme-head-inject-status.server"
);
const result = await attemptThemeHeadInject(session.shop, admin, {
  force: true,
});
return { ok: true, intent: "retry-head-inject", headInject: result };
}

export async function handleSelectTheme({ admin, session, formData }) {
const themeId = String(formData.get("themeId") || "");

let theme;
try {
  const themes = await withShopifyTimeout(listThemes(admin), "listThemes");
  // Also enforces the selectable roles (no development/archived themes).
  theme = themes.find((t) => t.id === themeId);
} catch (err) {
  rethrowAuthRedirect(err);
  return { ok: false, error: "Couldn't load themes. Please try again." };
}
if (!theme) return { ok: false, error: "Theme not found." };

const store = await prisma.store.findUnique({
  where: { shopDomain: session.shop },
  select: { id: true },
});
if (!store) return { ok: false, error: "Store record not found." };

const saved = await prisma.storeConfig.upsert({
  where: { storeId: store.id },
  create: {
    storeId: store.id,
    appEnabled: false,
    script1Enabled: false,
    script2Enabled: false,
    script3Enabled: false,
    debugMode: false,
    scriptTitles: [],
    selectedThemeId: theme.id,
  },
  update: { selectedThemeId: theme.id },
});

// Switching themes while the app is ON: if the new theme does not have the
// embed, the app can no longer work — turn it OFF (fail closed). An
// unknown result is left to the loader, which shows OFF without persisting.
const embed = await isAppEmbedEnabled(admin, undefined, theme.id);
if (embed === false && saved.appEnabled) {
  await disableAppBecauseEmbedOff({ admin, session, store });
}

await safeLogActivity(
  session.shop,
  "config_changed",
  `Extension theme set to ${theme.name}`,
  { changedFields: ["selectedThemeId"], themeId: theme.id },
);

return {
  ok: true,
  selectedThemeId: theme.id,
  embedStatus:
    embed === true ? "enabled" : embed === false ? "disabled" : "unknown",
  embedActivateUrl: getAppEmbedDeepLink(
    session.shop,
    undefined,
    undefined,
    theme.id,
  ),
};
}
