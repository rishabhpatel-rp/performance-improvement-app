import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REMOVED = [
  "app/lib/audit-core.server.ts",
  "app/lib/audit-run-hidden.server.ts",
  "app/lib/audit-run-page-measure.server.ts",
  "app/lib/audit-run-page-timing.ts",
  "app/lib/audit-resource-tokens.ts",
  "app/lib/audit-template-extra.ts",
  "app/lib/dashboard-loader.server.js",
  "app/lib/popup-audit.js",
  "app/lib/psi-preview-url.server.ts",
  "app/lib/shopify.ts",
  "app/lib/store-heal.server.ts",
  "app/components/FooterBranding.jsx.org",
  "app/components/PpPillButton.tsx",
  "admin-panel/src/components/settings-client.tsx",
  "admin-panel/src/components/store-purge-panel.tsx",
  "shopify.app.pagepulse.toml.org",
  "admin-panel/next.config.ts.org",
  "tests/audit-popups.test.js",
  "tests/audit-psi-preview-url.test.js",
  "tests/audit-template-extra.test.js",
];

test("duplicate audit scan modules stay deleted", () => {
  for (const rel of REMOVED) {
    const abs = path.join(process.cwd(), rel);
    assert.equal(fs.existsSync(abs), false, `dead module should not exist: ${rel}`);
  }
});
