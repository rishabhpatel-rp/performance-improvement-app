import { useEffect } from "react";
import { useLoaderData, useFetcher, useRouteError } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { getThemeEditorDeepLink } from "../lib/shopify";
import { getConfig, updateConfig, deleteConfig } from "../lib/metaobjects";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const config = await getConfig(admin);
  return { config, shop: session.shop };
};

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "reset") {
    try {
      await deleteConfig(admin);
    } catch {
      // Metaobject may not exist yet
    }
    return { ok: true, reset: true };
  }

  const debugMode = formData.get("debugMode") === "true";
  try {
    const config = await updateConfig(admin, { debugMode });
    return { ok: true, config };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("No metaobject definition exists")) {
      return { ok: true, config: { debugMode } };
    }
    throw err;
  }
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
      { debugMode: String(key === "debugMode" ? value : current.debugMode) },
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
  return boundary.error(useRouteError());
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
