import { isRouteErrorResponse, useRevalidator } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import SupportError from "./SupportError.tsx";

interface Props {
  error: unknown;
}

export default function RouteErrorBoundary({ error }: Props) {
  const revalidator = useRevalidator();

  if (isRouteErrorResponse(error)) return boundary.error(error);

  return (
    <s-page heading="We couldn't load this page">
      <SupportError
        title={error instanceof Error ? error.message : "Something went wrong."}
        error={error}
        onRetry={() => void revalidator.revalidate()}
      />
    </s-page>
  );
}
