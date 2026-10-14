import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  getAppEmbedDeepLink,
  resolveAppEmbedEnabled,
} from "../lib/theme-embed.server";

/** Lightweight embed re-check (focus / theme editor return) without full dashboard loader. */
export async function loader({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const force = new URL(request.url).searchParams.get("force") === "1";

  const sc = await prisma.storeConfig.findFirst({
    where: { store: { shopDomain: session.shop } },
    select: { selectedThemeId: true },
  });
  const selectedThemeId = sc?.selectedThemeId ?? null;

  const embedCheck = await resolveAppEmbedEnabled(
    admin,
    session.shop,
    selectedThemeId,
    { force },
  );
  const embedEnabled = embedCheck === true;
  const embedStatus =
    embedCheck === true ? "enabled" : embedCheck === false ? "disabled" : "unknown";

  return {
    embedEnabled,
    embedStatus,
    embedActivateUrl: getAppEmbedDeepLink(
      session.shop,
      undefined,
      undefined,
      selectedThemeId,
    ),
  };
}
