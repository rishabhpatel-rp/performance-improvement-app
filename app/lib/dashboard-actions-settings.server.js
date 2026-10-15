import prisma from "../db.server";
import { startAuditForStore } from "./audit-runner.server";
import {
  normalizeCustomUrl,
  normalizeCustomUrlList,
} from "./page-urls.server";

export async function handleSaveStorefrontPassword({ admin, session, formData }) {
const storefrontPassword = (formData.get("storefrontPassword") || "").trim();
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
    storefrontPassword: storefrontPassword || null,
  },
  update: { storefrontPassword: storefrontPassword || null },
});

const passwordAuditError =
  saved.auditError === "PASSWORD_REQUIRED" ||
  saved.auditError === "PASSWORD_INCORRECT" ||
  (saved.auditFailed && /password/i.test(String(saved.auditError || "")));
if (
  storefrontPassword &&
  saved.appEnabled &&
  (saved.auditRunning || passwordAuditError)
) {
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
return { ok: true, hasStorefrontPassword: Boolean(storefrontPassword) };
}

export async function handleSaveCustomPageUrls({ session, formData }) {
// Must be pages on this store; share-link params (_bt, key, preview_theme_id…)
// are stripped. Nothing is saved unless both fields are valid.
const plp = normalizeCustomUrl(formData.get("customPlpUrl"), session.shop, "plp");
const pdp = normalizeCustomUrl(formData.get("customPdpUrl"), session.shop, "pdp");
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
);
if (!extras.ok) {
  return {
    ok: false,
    plpError: plp.ok ? "" : plp.error,
    pdpError: pdp.ok ? "" : pdp.error,
    pageErrors: extras.errors,
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
  customPlpUrl,
  customPdpUrl,
  plpWarning: plp.warning || "",
  pdpWarning: pdp.warning || "",
};
}
