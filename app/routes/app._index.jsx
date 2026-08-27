import { useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getScripts,
  updateScript,
  deleteScript,
  reorderScripts,
  getGlobalConfig,
} from "../lib/metaobjects";
import { getThemeEditorDeepLink } from "../lib/shopify";
import ScriptList from "../components/ScriptList";

export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [scripts, config] = await Promise.all([
    getScripts(request),
    getGlobalConfig(request),
  ]);
  const url = new URL(request.url);
  return {
    scripts,
    showWelcome: url.searchParams.get("welcome") === "1",
    autoInject: config.autoInject,
    themeEditorUrl: getThemeEditorDeepLink(session.shop),
  };
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const id = formData.get("id");

  if (intent === "toggle") {
    const enabled = formData.get("enabled") === "true";
    await updateScript(request, id, { enabled: !enabled });
  } else if (intent === "delete") {
    await deleteScript(request, id);
  } else if (intent === "reorder") {
    const orderedIds = JSON.parse(formData.get("orderedIds") || "[]");
    await reorderScripts(request, orderedIds);
  }

  return { ok: true };
};

export default function Dashboard() {
  const { scripts, showWelcome, themeEditorUrl } = useLoaderData();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const navigate = useNavigate();

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Saved");
    }
  }, [fetcher.data, shopify]);

  useEffect(() => {
    if (showWelcome) {
      shopify.toast.show("Welcome! Add a script, then open the theme editor to place it.");
    }
  }, [showWelcome, shopify]);

  const handleToggle = (script) => {
    fetcher.submit(
      { intent: "toggle", id: script.id, enabled: String(script.enabled) },
      { method: "POST" },
    );
  };

  const handleDelete = (script) => {
    if (!confirm(`Delete "${script.name}"? This cannot be undone.`)) return;
    fetcher.submit(
      { intent: "delete", id: script.id },
      { method: "POST" },
    );
  };

  const handleReorder = (orderedIds) => {
    fetcher.submit(
      { intent: "reorder", orderedIds: JSON.stringify(orderedIds) },
      { method: "POST" },
    );
  };

  const handleGetStarted = () => {
    // Send merchant straight to the theme editor to place the extension block.
    open(themeEditorUrl, "_top");
  };

  return (
    <s-page heading="Scripts">
      <s-button
        slot="primary-action"
        onClick={() => navigate("/app/scripts/new")}
      >
        Add script
      </s-button>

      <s-section>
        {scripts.length === 0 ? (
          <s-stack direction="block" gap="base" alignItems="center">
            <s-heading>No scripts yet</s-heading>
            <s-paragraph>
              Add a script to start injecting it into your storefront.
            </s-paragraph>
            <s-stack direction="inline" gap="tight">
              <s-button
                variant="primary"
                onClick={() => navigate("/app/scripts/new")}
              >
                Add script
              </s-button>
              <s-button variant="secondary" onClick={handleGetStarted}>
                Get started: open theme editor
              </s-button>
            </s-stack>
          </s-stack>
        ) : (
          <ScriptList
            scripts={scripts}
            onToggle={handleToggle}
            onDelete={handleDelete}
            onReorder={handleReorder}
            themeEditorUrl={themeEditorUrl}
          />
        )}
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
