import { authenticate } from "../shopify.server";
import prisma from "../db.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
} from "../lib/theme-embed.server";
import { withShopifyTimeout, rethrowAuthRedirect } from "../lib/shopify-timeout.server";

// Per-call budget. Two Shopify calls run in parallel, so worst case is
// ~2s + network, well inside the <3s client budget in the plan.
const VALIDATE_TIMEOUT_MS = 2000;

async function fetchPasswordProtected(admin) {
  const response = await admin.graphql(`#graphql
    query OnlineStorePasswordStatus {
      onlineStore {
        passwordProtection {
          enabled
        }
      }
    }
  `);
  const data = await response.json();
  return data.data?.onlineStore?.passwordProtection?.enabled ?? false;
}

/**
 * POST /api/toggle-validate
 * Body: intent=validate-toggle
 *
 * Re-checks, live, the two conditions required to flip "Enable Performance
 * Improvement App" ON: the theme app embed is enabled, and (if the store is
 * password protected) a storefront password has been saved. Always
 * fail-closed — any timeout, error, or unexpected shape results in
 * `allowed: false` so the caller never flips the toggle ON.
 */
export const action = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);

  if (request.method !== "POST") {
    return { ok: false, allowed: false, blockReason: null };
  }

  const formData = await request.formData();
  const intent = formData.get("intent");
  const embedActivateUrl = getAppEmbedDeepLink(session.shop);

  if (intent !== "validate-toggle") {
    return { ok: false, allowed: false, blockReason: null, embedActivateUrl };
  }

  // Run both Shopify reads + the local DB read in parallel, each Shopify
  // call individually time-boxed so one slow Admin API call can't stall
  // the whole check.
  const [embedResult, passwordProtectedResult, savedPasswordResult] =
    await Promise.allSettled([
      withShopifyTimeout(
        isAppEmbedEnabled(admin),
        "isAppEmbedEnabled",
        VALIDATE_TIMEOUT_MS,
      ),
      withShopifyTimeout(
        fetchPasswordProtected(admin),
        "passwordProtection",
        VALIDATE_TIMEOUT_MS,
      ),
      prisma.store
        .findUnique({
          where: { shopDomain: session.shop },
          select: { configs: { select: { storefrontPassword: true } } },
        })
        .then((store) => store?.configs?.[0]?.storefrontPassword || ""),
    ]);

  // An embedded-session bounce (302 -> session-token refresh) surfaces as a
  // thrown Response inside one of the settled promises — let it propagate
  // so the client gets the redirect instead of a swallowed error.
  for (const settled of [embedResult, passwordProtectedResult]) {
    if (settled.status === "rejected") rethrowAuthRedirect(settled.reason);
  }

  // Fail-closed: a timeout/error, or an explicit non-true value, blocks.
  // (Mirrors isAppEmbedEnabled's own null-on-unknown = treat as NOT enabled.)
  const appEmbedEnabled =
    embedResult.status === "fulfilled" && embedResult.value === true;

  // Unknown password-protection status is treated as protected, so a failed
  // check can never let the toggle through unvalidated.
  const passwordProtected =
    passwordProtectedResult.status !== "fulfilled" ||
    passwordProtectedResult.value === true;

  const savedPassword =
    savedPasswordResult.status === "fulfilled" ? savedPasswordResult.value : "";
  const passwordSaved = Boolean(savedPassword);

  let blockReason = null;
  if (!appEmbedEnabled) {
    blockReason = "extension_required";
  } else if (passwordProtected && !passwordSaved) {
    blockReason = "password_required";
  }

  if (embedResult.status === "rejected") {
    console.warn(
      "[toggle-validate] isAppEmbedEnabled failed/timed out:",
      embedResult.reason instanceof Error
        ? embedResult.reason.message
        : embedResult.reason,
    );
  }
  if (passwordProtectedResult.status === "rejected") {
    console.warn(
      "[toggle-validate] passwordProtection check failed/timed out:",
      passwordProtectedResult.reason instanceof Error
        ? passwordProtectedResult.reason.message
        : passwordProtectedResult.reason,
    );
  }

  return {
    ok: true,
    allowed: blockReason === null,
    blockReason,
    appEmbedEnabled,
    passwordProtected,
    passwordSaved,
    embedActivateUrl,
  };
};
