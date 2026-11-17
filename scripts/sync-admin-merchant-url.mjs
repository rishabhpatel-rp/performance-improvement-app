#!/usr/bin/env node
/**
 * Point admin-panel PAGEPULSE_APP_URL at the running merchant Vite server.
 * Shopify CLI picks a random localhost port; this probes it via internal auth.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootEnv = path.join(root, ".env");
const adminEnv = path.join(root, "admin-panel", ".env");

function readSecret() {
  const text = fs.readFileSync(rootEnv, "utf8");
  const line = text.split("\n").find((row) => row.startsWith("INTERNAL_API_SECRET="));
  if (!line) throw new Error("INTERNAL_API_SECRET missing in root .env");
  return line.slice("INTERNAL_API_SECRET=".length).trim().replace(/^"|"$/g, "");
}

function candidatePorts() {
  const ports = new Set();
  try {
    const out = execSync("ss -tlnp 2>/dev/null", { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const m = line.match(/127\.0\.0\.1:(\d+)/);
      if (m) ports.add(Number(m[1]));
    }
  } catch {
    /* ignore */
  }
  const fromEnv = fs.readFileSync(rootEnv, "utf8").match(/^PORT=(\d+)/m);
  if (fromEnv) ports.add(Number(fromEnv[1]));
  ports.add(9001);
  return [...ports].filter((p) => p > 1024 && p < 65535);
}

async function probe(port, secret) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/internal/storefront-state`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pagepulse-internal": secret,
      },
      body: JSON.stringify({ shopDomain: "health-check.invalid" }),
    });
    const text = await res.text();
    try {
      const data = JSON.parse(text);
      return data !== null && typeof data === "object" && "ok" in data;
    } catch {
      return false;
    }
  } catch {
    return false;
  }
}

async function main() {
  const secret = readSecret();
  let found = null;
  for (const port of candidatePorts()) {
    if (await probe(port, secret)) {
      found = port;
      break;
    }
  }
  if (!found) {
    console.error(
      "Could not find merchant dev server. Start: npx shopify app dev --config pagepulse ...",
    );
    process.exit(1);
  }
  const url = `http://127.0.0.1:${found}`;
  let adminText = fs.readFileSync(adminEnv, "utf8");
  if (/^PAGEPULSE_APP_URL=/m.test(adminText)) {
    adminText = adminText.replace(
      /^PAGEPULSE_APP_URL=.*$/m,
      `PAGEPULSE_APP_URL="${url}"`,
    );
  } else {
    adminText += `\nPAGEPULSE_APP_URL="${url}"\n`;
  }
  fs.writeFileSync(adminEnv, adminText);
  console.log(`Updated admin-panel/.env PAGEPULSE_APP_URL=${url}`);
}

await main();