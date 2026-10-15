import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SNIPPET_REL = "extensions/script-injector/snippets/pagepulse-inline.liquid";

/**
 * The production bundle lives under `build/server/...`. A fixed `../../`
 * from that file opens `build/extensions/...`, which is not deployed.
 * Walk up from cwd and from this module until the repo snippet is found.
 */
export function findSnippetPath(
  starts = [process.cwd(), path.dirname(fileURLToPath(import.meta.url))],
) {
  const seen = new Set();
  const candidates = [];
  const add = (p) => {
    const abs = path.resolve(p);
    if (seen.has(abs)) return;
    seen.add(abs);
    candidates.push(abs);
  };
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 8; i++) {
      add(path.join(dir, SNIPPET_REL));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  const found = candidates.find((p) => fs.existsSync(p));
  if (!found) {
    throw new Error(
      `pagepulse-inline.liquid not found. Looked in: ${candidates.join(", ")}`,
    );
  }
  return found;
}

export function readExtensionInlineSnippetLiquid() {
  return fs.readFileSync(findSnippetPath(), "utf8");
}

export function isThemeFilesExemptDenied(reason) {
  return /exemption from Shopify/i.test(reason);
}

export const THEME_HEAD_INJECT_STATUS = {
  NOT_ATTEMPTED: "not_attempted",
  SKIPPED: "skipped",
  INJECTED: "injected",
  EXEMPT_DENIED: "exempt_denied",
  ERROR: "error",
};
