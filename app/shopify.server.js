import { getEnv } from "./lib/env.server.ts";
import "@shopify/shopify-app-react-router/adapters/node";
import "./lib/boot.server";
import { ApiVersion, AppDistribution, shopifyApp } from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";

const shopify = shopifyApp({
  apiKey: getEnv().SHOPIFY_API_KEY,
  apiSecretKey: getEnv().SHOPIFY_API_SECRET,
  apiVersion: ApiVersion.July26,
  scopes: getEnv().SCOPES,
  appUrl: getEnv().SHOPIFY_APP_URL,
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(getEnv().SHOP_CUSTOM_DOMAIN ? { customShopDomains: [getEnv().SHOP_CUSTOM_DOMAIN] } : {}),
});

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
