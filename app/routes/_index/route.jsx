import { redirect } from "react-router";

// The embedded app opens at the root URL. There is no landing page anymore —
// the wizard lives at /app — so forward home straight there, preserving any
// query params (e.g. shop=...&embedded=1) for the auth + app-bridge flow.
export const loader = async ({ request }) => {
  const url = new URL(request.url);
  const params = url.searchParams.toString();
  throw redirect(`/app${params ? `?${params}` : ""}`);
};