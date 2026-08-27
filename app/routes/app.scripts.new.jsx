import { useEffect } from "react";
import { useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { createScript, getScripts } from "../lib/metaobjects";
import ScriptForm from "../components/ScriptForm";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

export const action = async ({ request }) => {
  await authenticate.admin(request);
  const formData = await request.formData();
  const input = JSON.parse(formData.get("payload"));

  try {
    const existing = await getScripts(request);
    const priority = existing.length;
    const script = await createScript(request, { ...input, priority });
    return { ok: true, id: script.id };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function NewScript() {
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Script created");
      navigate(`/app/scripts/${encodeURIComponent(fetcher.data.id)}`);
    } else if (fetcher.data?.ok === false) {
      shopify.toast.show(fetcher.data.error, { isError: true });
    }
  }, [fetcher.data, navigate, shopify]);

  const handleSubmit = (input) => {
    fetcher.submit(
      { payload: JSON.stringify(input) },
      { method: "POST" },
    );
  };

  return (
    <s-page heading="Add script" backAction="/app">
      <s-section>
        <ScriptForm
          onSubmit={handleSubmit}
          onCancel={() => navigate("/app")}
          isLoading={isLoading}
        />
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
