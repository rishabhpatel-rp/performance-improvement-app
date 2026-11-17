import { resolveShopAdmin } from "./internal-shop-session.server";
import {
  getAppEmbedDeepLink,
  getSelectedThemeId,
  isAppEmbedEnabled,
} from "./theme-embed.server";

export async function loadStoreControlHealth(shopDomain) {
  const resolved = await resolveShopAdmin(shopDomain);
  if (!resolved.ok) {
    return {
      sessionOk: false,
      embedStatus: "unknown",
      embedActivateUrl: null,
      sessionError: resolved.error,
    };
  }
  const { admin } = resolved;
  const selectedThemeId = await getSelectedThemeId(shopDomain).catch(() => null);
  let embedCheck = null;
  try {
    embedCheck = await isAppEmbedEnabled(admin, undefined, selectedThemeId);
  } catch {
    embedCheck = null;
  }
  const embedStatus =
    embedCheck === true ? "enabled" : embedCheck === false ? "disabled" : "unknown";
  return {
    sessionOk: true,
    embedStatus,
    embedActivateUrl:
      embedStatus === "disabled"
        ? getAppEmbedDeepLink(shopDomain, undefined, undefined, selectedThemeId)
        : null,
    selectedThemeId,
    sessionError: null,
  };
}