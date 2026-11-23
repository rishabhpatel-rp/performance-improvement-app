#!/usr/bin/env node
/**
 * Point admin-panel at the running merchant dev server.
 *
 * Shopify CLI picks a random localhost port. Each candidate is fingerprinted
 * WITHOUT the secret first (the merchant app answers a secret-less internal
 * call with 401 "Unauthorized"); only a port that identifies itself that way
 * is then sent the real secret, so unrelated local services never see it.
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const rootEnv = path.join(root, ".env");
const adminEnv = path.join(root, "admin-panel", ".env");
const SECRET_NAMES = ["INTERNAL_API_SECRET", "ADMIN_INTERNAL_SECRET"];
const URL_NAMES = ["PAGEPULSE_INTERNAL_URL", "PAGEPULSE_APP_URL"];

function readEnvFile(file) {
  if (!fs.existsSync(file)) return "";
  return fs.readFileSync(file, "utf8");
}

function envValue(text, name) {
  const row = text.split(/\r?\n/).find((line) => line.startsWith(`${name}=`));
  return row
    ? row
        .slice(name.length + 1)
        .trim()
        .replace(/^"|"$/g, "")
    : "";
}

function readSecret() {
  const text = readEnvFile(rootEnv);
  for (const name of SECRET_NAMES) {
    const value = envValue(text, name);
    if (value) return value;
  }
  throw new Error(`${SECRET_NAMES[0]} missing in root .env`);
}

function candidatePorts() {
  const ports = new Set();
  const fromEnv = envValue(readEnvFile(rootEnv), "PORT");
  if (/^\d+$/.test(fromEnv)) ports.add(Number(fromEnv));
  try {
    const out = execSync("ss -tlnp 2>/dev/null", { encoding: "utf8" });
    for (const line of out.split("\n")) {
      const match = line.match(/127\.0\.0\.1:(\d+)/);
      if (match) ports.add(Number(match[1]));
    }
  } catch {
    /* `ss` is unavailable on macOS/Windows: fall back to known ports */
  }
  ports.add(9001);
  return [...ports].filter((port) => port > 1024 && port < 65535);
}

async function callState(port, secret) {
  const headers = { "Content-Type": "application/json" };
  if (secret) headers["x-pagepulse-internal"] = secret;
  const res = await fetch(`http://127.0.0.1:${port}/api/internal/storefront-state`, {
    method: "POST",
    headers,
    body: JSON.stringify({ shopDomain: "health-check.invalid" }),
    signal: AbortSignal.timeout(2000),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

/** True only for the PagePulse merchant app, verified with the real secret. */
async function isMerchantApp(port, secret) {
  try {
    const anonymous = await callState(port);
    if (anonymous.status !== 401 || anonymous.data?.error !== "Unauthorized") {
      return false;
    }
    const authed = await callState(port, secret);
    // A valid secret on an unknown shop is a 404; anything else (401) means a
    // secret mismatch and the URL would not work from the admin panel anyway.
    return authed.status === 404 && authed.data?.ok === false;
  } catch {
    return false;
  }
}

function writeAdminUrl(url) {
  let text = readEnvFile(adminEnv);
  // Update whichever variable the admin panel reads first, so a stale
  // PAGEPULSE_INTERNAL_URL can never shadow the freshly detected URL.
  const target = URL_NAMES.find((name) => new RegExp(`^${name}=`, "m").test(text)) ?? URL_NAMES[1];
  if (new RegExp(`^${target}=`, "m").test(text)) {
    text = text.replace(new RegExp(`^${target}=.*$`, "m"), `${target}="${url}"`);
  } else {
    text += `${text && !text.endsWith("\n") ? "\n" : ""}${target}="${url}"\n`;
  }
  // Keep every URL variable that is present in agreement.
  for (const name of URL_NAMES) {
    if (name !== target && new RegExp(`^${name}=`, "m").test(text)) {
      text = text.replace(new RegExp(`^${name}=.*$`, "m"), `${name}="${url}"`);
    }
  }
  fs.writeFileSync(adminEnv, text);
  return target;
}

async function main() {
  const secret = readSecret();
  for (const port of candidatePorts()) {
    if (await isMerchantApp(port, secret)) {
      const url = `http://127.0.0.1:${port}`;
      const name = writeAdminUrl(url);
      console.log(`Updated admin-panel/.env ${name}=${url}`);
      return;
    }
  }
  console.error(
    "Could not find the merchant dev server (or INTERNAL_API_SECRET does not match). Start: npx shopify app dev",
  );
  process.exit(1);
}

await main();
