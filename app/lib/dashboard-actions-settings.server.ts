/* eslint-disable @typescript-eslint/no-explicit-any -- gradual TS migration of legacy modules */
import { MAX_EXTRA_PAGES } from "./constants.ts";
import prisma from "../db.server";
import { startAuditForStore } from "./audit-runner.server";
import { normalizeCustomUrl, normalizeCustomUrlList } from "./page-urls.server";
import { getAllowedStoreHosts } from "./store-hosts.server";
import { encryptStorefrontPassword } from "./storefront-password.server.ts";
import { maybeFirstActivation } from "./first-activation.server.ts";

export async function handleSaveStorefrontPassword({ admin, session, formData }: any) {
  const storefrontPassword = (formData.get("storefrontPassword") || "").trim();
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });
  if (!store) return { ok: false, error: "Store record not found." };
  const storedPassword = encryptStorefrontPassword(storefrontPassword);
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
      storefrontPassword: storedPassword,
    },
    update: { storefrontPassword: storedPassword },
  });

  const passwordAuditError =
    saved.auditError === "PASSWORD_REQUIRED" ||
    saved.auditError === "PASSWORD_INCORRECT" ||
    (saved.auditFailed && /password/i.test(String(saved.auditError || "")));

  // Already enabled: restart audit when a password block (or in-flight run) needs
  // the newly saved password.
  if (storefrontPassword && saved.appEnabled && (saved.auditRunning || passwordAuditError)) {
    try {
      const { started } = await startAuditForStore(admin, session.shop);
      return {
        ok: true,
        hasStorefrontPassword: true,
        auditRestarted: started,
      };
    } catch (err) {
      console.warn(
        "[Dashboard] Failed to restart audit after password save:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  // First run: password just saved with app still off → try one-shot activation.
  let firstActivation = null;
  if (storefrontPassword && !saved.appEnabled) {
    firstActivation = await maybeFirstActivation({ admin, session });
  }

  return {
    ok: true,
    hasStorefrontPassword: Boolean(storefrontPassword),
    auditRestarted: firstActivation?.auditStarted === true,
    firstActivation,
  };
}

export async function handleSaveCustomPageUrls({ session, formData }: any) {
  // Must be pages on this store; share-link params (_bt, key, preview_theme_id…)
  // are stripped. Nothing is saved unless both fields are valid.
  const allowedHosts = await getAllowedStoreHosts(session.shop);
  const plp = normalizeCustomUrl(formData.get("customPlpUrl"), session.shop, "plp", allowedHosts);
  const pdp = normalizeCustomUrl(formData.get("customPdpUrl"), session.shop, "pdp", allowedHosts);
  if (!plp.ok || !pdp.ok) {
    return {
      ok: false,
      plpError: plp.ok ? "" : plp.error,
      pdpError: pdp.ok ? "" : pdp.error,
    };
  }
  const customPlpUrl = plp.url || "";
  const customPdpUrl = pdp.url || "";
  // Extra rows from the "+" button. getAll picks up every customPageUrls field
  // the UI rendered, in order.
  const extras = normalizeCustomUrlList(
    formData.getAll("customPageUrls"),
    session.shop,
    allowedHosts,
  );
  if (!extras.ok) {
    return {
      ok: false,
      plpError: plp.ok ? "" : plp.error,
      pdpError: pdp.ok ? "" : pdp.error,
      pageErrors: extras.errors,
      tooManyPages: extras.tooMany === true,
    };
  }
  const store = await prisma.store.findUnique({
    where: { shopDomain: session.shop },
    select: { id: true },
  });
  if (!store) return { ok: false, error: "Store record not found." };
  await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      appEnabled: false,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      customPlpUrl: customPlpUrl || null,
      customPdpUrl: customPdpUrl || null,
      customPageUrls: extras.urls,
    },
    update: {
      customPlpUrl: customPlpUrl || null,
      customPdpUrl: customPdpUrl || null,
      customPageUrls: extras.urls,
    },
  });
  return {
    ok: true,
    maxExtraPages: MAX_EXTRA_PAGES,
    customPlpUrl,
    customPdpUrl,
    plpWarning: plp.warning || "",
    pdpWarning: pdp.warning || "",
  };
}
