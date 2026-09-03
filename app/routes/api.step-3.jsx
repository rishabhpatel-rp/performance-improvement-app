"use server";

import { authenticate } from "../shopify.server";
import { PREDEFINED_SCRIPTS } from "../lib/scripts";

function json(data, options = {}) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
}

/**
 * POST /api/step-3
 *
 * Serves the Step 3 script payloads (id, display name, type and the actual
 * JavaScript code injected storefront-side) from the Node back end. The
 * dashboard calls this via POST when the wizard navigates to Step 3 so the
 * script code lives server-side and can be swapped without touching the client.
 */
export async function action({ request }) {
  if (request.method !== "POST") {
    return json(
      { success: false, error: "Method not allowed. Use POST." },
      { status: 405 },
    );
  }

  try {
    await authenticate.admin(request);

    const scripts = PREDEFINED_SCRIPTS.map(({ id, name, type, code }) => ({
      id,
      name,
      type,
      code,
    }));

    return json({
      success: true,
      scripts,
      fetchedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[Step 3 API Error]:", error);
    return json(
      { success: false, error: "Internal server error" },
      { status: 500 },
    );
  }
}