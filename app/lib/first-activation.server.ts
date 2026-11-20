/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
/**
 * One-shot first activation after the theme embed is enabled (and password is
 * OK). Lives outside dashboard-actions-audit so callers can import it without a
 * cycle: this module imports handleToggleApp; audit does not import this file.
 */
import prisma from "../db.server";
import { isEligibleForFirstActivation } from "./first-activation.ts";
import { handleToggleApp } from "./dashboard-actions-audit.server.ts";
import { getPasswordProtection } from "./password-protection.server";
import { isAppEmbedEnabled, getSelectedThemeId } from "./theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "./shopify-timeout.server";

const PASSWORD_CHECK_TIMEOUT_MS = 10_000;

export async function maybeFirstActivation({
  admin,
  session,
  activityMeta = {},
}: {
  admin: any;
  session: { shop: string };
  activityMeta?: Record<string, unknown>;
}) {
  const shop = session.shop;
  const store = await prisma.store.findUnique({
    where: { shopDomain: shop },
    select: {
      id: true,
      configs: {
        select: {
          onboardingActivated: true,
          adminManaged: true,
          appEnabled: true,
          storefrontPassword: true,
          isPasswordProtected: true,
          selectedThemeId: true,
        },
      },
    },
  });
  const sc = store?.configs?.[0];
  if (!sc) return { ok: true, activated: false, reason: "no_config" };
  if (sc.onboardingActivated) return { ok: true, activated: false, reason: "already_activated" };
  if (sc.adminManaged) return { ok: true, activated: false, reason: "admin_managed" };
  if (sc.appEnabled) {
    await prisma.storeConfig.updateMany({
      where: { storeId: store!.id, onboardingActivated: false },
      data: { onboardingActivated: true },
    });
    return { ok: true, activated: false, reason: "already_enabled" };
  }

  const selectedThemeId = sc.selectedThemeId || (await getSelectedThemeId(shop).catch(() => null));
  const embedCheck = await isAppEmbedEnabled(admin, undefined, selectedThemeId);
  const embedEnabled = embedCheck === true;

  let passwordProtected: boolean | null = sc.isPasswordProtected ?? null;
  if (passwordProtected === null) {
    try {
      passwordProtected = await withShopifyTimeout(
        getPasswordProtection(admin, shop),
        "passwordProtection",
        PASSWORD_CHECK_TIMEOUT_MS,
      );
    } catch (err) {
      rethrowAuthRedirect(err);
      passwordProtected = null;
    }
  }

  const eligible = isEligibleForFirstActivation({
    onboardingActivated: false,
    adminManaged: sc.adminManaged,
    appEnabled: false,
    hasStorefrontPassword: Boolean(sc.storefrontPassword),
    passwordProtected,
    embedEnabled,
  });
  if (!eligible) {
    return {
      ok: true,
      activated: false,
      reason: !embedEnabled
        ? "embed_required"
        : passwordProtected === true && !sc.storefrontPassword
          ? "password_required"
          : "not_eligible",
    };
  }

  const fd = new FormData();
  fd.set("intent", "toggle-app");
  fd.set("appEnabled", "true");
  const toggled = await handleToggleApp({
    admin,
    session,
    formData: fd,
    activityMeta: { ...activityMeta, by: activityMeta.by || "first-activation" },
  });
  if (!toggled?.ok) {
    return {
      ok: false,
      activated: false,
      reason: toggled?.error || "toggle_failed",
      ...toggled,
    };
  }

  // handleToggleApp also sets onboardingActivated; keep an explicit write for
  // soft-fail audit-start cases where enable already succeeded.
  await prisma.storeConfig.updateMany({
    where: { storeId: store!.id, onboardingActivated: false },
    data: { onboardingActivated: true },
  });

  return {
    ok: true,
    activated: true,
    auditStarted: toggled.auditStarted === true,
    config: toggled.config,
  };
}

export async function handleMaybeFirstActivation(args: any) {
  return maybeFirstActivation(args);
}
