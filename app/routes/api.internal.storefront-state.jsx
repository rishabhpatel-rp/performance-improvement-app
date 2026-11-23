import { json, parseInternalRequest, readInternalSecret } from "../lib/internal-request.ts";
import { loadStoreStep2Snapshot } from "../lib/step2-config.server";

/** Read-only snapshot (config, audit, health, setup flags, version) for admin polling. */
export const action = async ({ request }) => {
  const parsed = await parseInternalRequest(request, readInternalSecret());
  if (!parsed.ok) return json(parsed.rejection.body, parsed.rejection.status);

  const snapshot = await loadStoreStep2Snapshot(parsed.shopDomain);
  if (!snapshot) {
    return json({ ok: false, error: "Store config not found." }, 404);
  }
  return json({ ok: true, ...snapshot });
};
