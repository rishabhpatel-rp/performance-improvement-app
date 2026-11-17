import { internalAuthOk } from "./scan-summary-scope.js";
import { readInternalSecret } from "./internal-storefront-route.js";

const CONTROL_INTENTS = new Set([
  "toggle-app",
  "start-audit",
  "stop-audit",
  "set-admin-managed",
  "retry-head-inject",
]);

function reject(status, error) {
  return { status, body: { ok: false, error }, write: null };
}

export async function decideInternalStoreControlRequest(request, secret) {
  if (request.method !== "POST") {
    return reject(405, "POST only");
  }
  if (!internalAuthOk(request.headers.get("x-pagepulse-internal"), secret)) {
    return reject(401, "Unauthorized");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return reject(400, "Invalid JSON");
  }

  const shopDomain = String(body?.shopDomain || "").trim();
  if (!shopDomain) {
    return reject(400, "Missing shopDomain.");
  }

  const intent = String(body?.intent || "");
  if (!CONTROL_INTENTS.has(intent)) {
    return reject(400, "Invalid intent.");
  }

  if (intent === "toggle-app") {
    if (typeof body.appEnabled !== "boolean") {
      return reject(400, "appEnabled must be a boolean.");
    }
    const force = body.force === true && body.appEnabled === true;
    if (
      force &&
      process.env.ADMIN_ALLOW_FORCE_APP_ON !== "true" &&
      process.env.NODE_ENV === "production"
    ) {
      return reject(400, "Force ON is disabled (set ADMIN_ALLOW_FORCE_APP_ON=true).");
    }
    return {
      status: 200,
      body: null,
      write: {
        kind: "toggle-app",
        shopDomain,
        appEnabled: body.appEnabled,
        force,
        actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : null,
      },
    };
  }

  if (intent === "set-admin-managed") {
    if (typeof body.adminManaged !== "boolean") {
      return reject(400, "adminManaged must be a boolean.");
    }
    return {
      status: 200,
      body: null,
      write: {
        kind: "set-admin-managed",
        shopDomain,
        adminManaged: body.adminManaged,
        actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : null,
      },
    };
  }

  return {
    status: 200,
    body: null,
    write: {
      kind: intent,
      shopDomain,
      actorEmail: typeof body.actorEmail === "string" ? body.actorEmail : null,
    },
  };
}

export { readInternalSecret };