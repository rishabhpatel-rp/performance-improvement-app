import { useEffect } from "react";
import { useLoaderData, useFetcher } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getThemeEditorDeepLink } from "../lib/shopify";
import {
  getGlobalConfig,
  updateGlobalConfig,
  deleteAllScriptsForShop,
  deleteGlobalConfig,
} from "../lib/metaobjects";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const config = await getGlobalConfig(request);
  return { config, shop: session.shop };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reset") {
    await deleteAllScriptsForShop(request);
    await deleteGlobalConfig(request);
    return { ok: true, reset: true };
  }

  const autoInject = formData.get("autoInject") === "true";
  const debugMode = formData.get("debugMode") === "true";
  const config = await updateGlobalConfig(request, { autoInject, debugMode });
  return { ok: true, config };
};

export default function Settings() {
  const { config, shop } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show(
        fetcher.data.reset ? "All data reset" : "Settings saved",
      );
    }
  }, [fetcher.data, shopify]);

  const current = fetcher.data?.config || config;

  const updateSetting = (key, value) => {
    fetcher.submit(
      {
        autoInject: String(key === "autoInject" ? value : current.autoInject),
        debugMode: String(key === "debugMode" ? value : current.debugMode),
      },
      { method: "POST" },
    );
  };

  const handleReset = () => {
    if (
      !confirm(
        "Delete all scripts and settings for this shop? This cannot be undone.",
      )
    )
      return;
    fetcher.submit({ intent: "reset" }, { method: "POST" });
  };

  const themeEditorUrl = getThemeEditorDeepLink(shop);

  return (
    <s-page heading="Settings" backAction="/app">
      <s-section heading="General">
        <s-stack direction="block" gap="base">
          <s-switch
            label="Auto-inject scripts on all pages"
            checked={current.autoInject}
            onChange={(e) => updateSetting("autoInject", e.target.checked)}
          />
          <s-switch
            label="Debug mode"
            helpText="Adds console logging to injected scripts"
            checked={current.debugMode}
            onChange={(e) => updateSetting("debugMode", e.target.checked)}
          />
        </s-stack>
      </s-section>

      <s-section heading="Theme app extension">
        <s-paragraph>
          Add and configure script blocks in the theme editor.
        </s-paragraph>
        <s-button href={themeEditorUrl} target="_blank">
          Open theme editor
        </s-button>
      </s-section>

      <s-section heading="Danger zone">
        <s-paragraph>
          Permanently delete all scripts and settings for this shop.
        </s-paragraph>
        <s-button tone="critical" onClick={handleReset}>
          Reset all data
        </s-button>
      </s-section>
    </s-page>
  );
}

export function ErrorBoundary() {
  return boundary.error();
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
