import { useEffect } from "react";
import { useLoaderData, useFetcher, useNavigate } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import {
  getScript,
  updateScript,
  deleteScript,
  createScript,
} from "../lib/metaobjects";
import ScriptForm from "../components/ScriptForm";

export const loader = async ({ request, params }) => {
  await authenticate.admin(request);
  const script = await getScript(request, decodeURIComponent(params.id));
  if (!script) {
    throw new Response("Script not found", { status: 404 });
  }
  return { script };
};

export const action = async ({ request, params }) => {
  await authenticate.admin(request);
  const id = decodeURIComponent(params.id);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "delete") {
      await deleteScript(request, id);
      return { ok: true, redirect: "/app" };
    }

    if (intent === "duplicate") {
      const original = await getScript(request, id);
      const copy = await createScript(request, {
        ...original,
        name: `Copy of ${original.name}`,
      });
      return { ok: true, redirect: `/app/scripts/${encodeURIComponent(copy.id)}` };
    }

    const input = JSON.parse(formData.get("payload"));
    await updateScript(request, id, input);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
};

export default function EditScript() {
  const { script } = useLoaderData();
  const fetcher = useFetcher();
  const navigate = useNavigate();
  const shopify = useAppBridge();
  const isLoading = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.data?.ok) {
      shopify.toast.show("Saved");
      if (fetcher.data.redirect) {
        navigate(fetcher.data.redirect);
      }
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

  const handleDelete = () => {
    if (!confirm(`Delete "${script.name}"? This cannot be undone.`)) return;
    fetcher.submit({ intent: "delete" }, { method: "POST" });
  };

  const handleDuplicate = () => {
    fetcher.submit({ intent: "duplicate" }, { method: "POST" });
  };

  return (
    <s-page heading={script.name} backAction="/app">
      <s-button slot="primary-action" onClick={handleDuplicate}>
        Duplicate
      </s-button>
      <s-button
        slot="secondary-actions"
        tone="critical"
        onClick={handleDelete}
      >
        Delete
      </s-button>

      <s-section>
        <ScriptForm
          initialData={script}
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
