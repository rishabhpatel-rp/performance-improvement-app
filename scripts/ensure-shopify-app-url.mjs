#!/usr/bin/env node
/**
 * Worker + offline admin need SHOPIFY_APP_URL in root .env (CLI often only sets it at runtime).
 * If missing, copy from the merchant URL sync helper’s detected port.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");

function readEnv() {
  if (!fs.existsSync(envPath)) return { text: "", map: new Map() };
  const text = fs.readFileSync(envPath, "utf8");
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    map.set(line.slice(0, i), line.slice(i + 1));
  }
  return { text, map };
}

function readAdminMerchantLocalUrl() {
  const adminEnv = path.join(root, "admin-panel", ".env");
  if (!fs.existsSync(adminEnv)) return "";
  const adminText = fs.readFileSync(adminEnv, "utf8");
  for (const key of ["PAGEPULSE_INTERNAL_URL", "PAGEPULSE_APP_URL"]) {
    const row = adminText.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    if (row) {
      const v = row
        .slice(key.length + 1)
        .trim()
        .replace(/^"|"$/g, "");
      if (v) return v;
    }
  }
  return "";
}

function detectMerchantUrl({ preferLocal = false } = {}) {
  const { map } = readEnv();
  if (preferLocal) {
    const local = readAdminMerchantLocalUrl();
    if (local) return local;
  }
  const fromEnv = map.get("SHOPIFY_APP_URL")?.replace(/^"|"$/g, "").trim();
  if (fromEnv) return fromEnv;

  const local = readAdminMerchantLocalUrl();
  if (local) return local;

  try {
    const out = execSync("ss -tlnp 2>/dev/null | rg 'node|shopify' || true", {
      encoding: "utf8",
    });
    const m = out.match(/127\.0\.0\.1:(\d+)/);
    if (m) return `http://127.0.0.1:${m[1]}`;
  } catch {
    /* ignore */
  }
  return "";
}

async function healthOk(base) {
  if (!base) return false;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/api/healthz`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const current = readEnv().map.get("SHOPIFY_APP_URL")?.replace(/^"|"$/g, "").trim();
const currentHealthy = current ? await healthOk(current) : false;
const detected = detectMerchantUrl({ preferLocal: current && !currentHealthy });

if (currentHealthy) {
  console.log("SHOPIFY_APP_URL already set and healthy");
  process.exit(0);
}
if (!detected) {
  console.error(
    "SHOPIFY_APP_URL missing or unhealthy — start `shopify app dev` then run: node scripts/sync-admin-merchant-url.mjs",
  );
  process.exit(1);
}

let text = fs.readFileSync(envPath, "utf8");
const nextUrl = detected;
const note = current && !currentHealthy ? " (replaced stale URL)" : "";
if (text.includes("SHOPIFY_APP_URL=")) {
  text = text.replace(/^SHOPIFY_APP_URL=.*$/m, `SHOPIFY_APP_URL="${nextUrl}"`);
} else {
  text = `${text.trimEnd()}\nSHOPIFY_APP_URL="${nextUrl}"\n`;
}
fs.writeFileSync(envPath, text);
console.log(`Wrote SHOPIFY_APP_URL=${nextUrl}${note}`);
