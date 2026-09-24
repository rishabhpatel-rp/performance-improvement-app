import { useEffect } from "react";
import { useLoaderData, useRevalidator, useRouteError, useSearchParams } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  isAppEmbedEnabled,
  getAppEmbedDeepLink,
  getSelectedThemeId,
  listThemes,
} from "../lib/theme-embed.server";

export const loader = async ({ request }) => {
  const { admin, session } = await authenticate.admin(request);
  const selectedThemeId = await getSelectedThemeId(session.shop).catch(
    () => null,
  );
  const [embedEnabled, themes] = await Promise.all([
    isAppEmbedEnabled(admin, undefined, selectedThemeId),
    listThemes(admin).catch(() => []),
  ]);
  const theme = themes.find((t) =>
    selectedThemeId ? t.id === selectedThemeId : t.role === "MAIN",
  );
  return {
    shop: session.shop,
    embedEnabled: embedEnabled === true,
    embedUnknown: embedEnabled === null,
    themeName: theme?.name ?? "",
    embedActivateUrl: getAppEmbedDeepLink(
      session.shop,
      undefined,
      undefined,
      selectedThemeId,
    ),
  };
};

export default function ExtensionInstall() {
  const { embedEnabled, embedUnknown, embedActivateUrl, themeName } =
    useLoaderData();
  const themeLabel = themeName ? `“${themeName}”` : "your live theme";
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const fromToggle = searchParams.get("from") === "toggle";

  // Re-check the embed status whenever the merchant returns (e.g. after
  // enabling it in the theme editor tab that the button below opens).
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void revalidator.revalidate();
      }
    };
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revalidator]);

  return (
    <s-page heading="App extension" backAction="/app">
      <s-section heading="Theme app embed">
        <s-stack direction="block" gap="base">
          {embedEnabled ? (
            <s-banner tone="success">
              The Performance Script Loader embed is on for {themeLabel}.
              You can now return to the dashboard and turn the app ON in
              Step 1.
            </s-banner>
          ) : embedUnknown ? (
            <s-banner tone="warning">
              We could not confirm whether the embed is on. Enable it in the
              theme editor to be sure the storefront scripts load.
            </s-banner>
          ) : (
            <s-banner tone="warning">
              The theme app embed is off for {themeLabel}. Turn it on in the
              theme editor to install the extension before starting an audit.
            </s-banner>
          )}

          <s-paragraph>
            Shopify keeps app embeds off until you enable them. Click the
            button below to open the theme editor with this app selected,
            then toggle <strong>Performance Script Loader</strong> ON and
            save.
          </s-paragraph>

          {fromToggle && !embedEnabled && (
            <s-banner tone="info">
              The audit can&apos;t start until the embed is enabled. After
              you turn it on in the theme editor and come back, this page
              refreshes automatically.
            </s-banner>
          )}

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <s-button
              variant="primary"
              href={embedActivateUrl}
              target="_blank"
            >
              {embedEnabled ? "Open theme editor" : "Enable app embed"}
            </s-button>
            <s-button href="/app" variant="secondary">
              Back to dashboard
            </s-button>
          </div>
        </s-stack>
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