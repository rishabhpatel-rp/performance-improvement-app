// Creates the first admin user for the admin panel from environment
// variables. Plain .mjs on purpose: this has to run on a production box
// where devDependencies (including `tsx`, used by db:seed) may not be
// installed, so it may only rely on `bcryptjs` and `@prisma/client` — both
// regular dependencies — plus core `node:*` modules.
//
//   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run admin:ensure
//
// The password is never read from a default and never written to disk or to
// this file; it must be supplied explicitly (REQUIREMENTS_AND_PLANS.md R1 #6).
// Re-running is safe: an existing account is left completely untouched,
// including its password.

import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const here = dirname(fileURLToPath(import.meta.url));
const panelRoot = resolve(here, "..");

// Prisma normally loads .env itself, but that is not reliable for a bare node
// process, so do it here when DATABASE_URL has not already been exported.
if (!process.env.DATABASE_URL) {
  for (const file of [".env", ".env.local"]) {
    const path = resolve(panelRoot, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key] !== undefined) continue;
      process.env[key] = rawValue.replace(/^["'](.*)["']$/, "$1");
    }
  }
}

const email = (process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD || "";
const name = process.env.SEED_ADMIN_NAME || "Admin";

if (!process.env.DATABASE_URL) {
  console.error(
    "DATABASE_URL is not set and no .env was found next to this script.",
  );
  process.exit(1);
}

if (!email || !password) {
  console.error(
    "SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD are both required.\n" +
      "Refusing to invent a default — use the /setup page for first-run instead:\n" +
      "  https://<admin-panel-domain>/setup",
  );
  process.exit(1);
}

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`SEED_ADMIN_EMAIL is not a valid email address: ${email}`);
  process.exit(1);
}

if (password.length < 12) {
  console.error(
    "SEED_ADMIN_PASSWORD must be at least 12 characters " +
      `(got ${password.length}). Refusing to create a weak admin credential.`,
  );
  process.exit(1);
}

const prisma = new PrismaClient();

try {
  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin ${email} already exists — nothing changed.`);
    process.exit(0);
  }

  const total = await prisma.adminUser.count();
  if (total > 0) {
    console.log(
      `${total} admin user(s) already exist and ${email} is not one of them.\n` +
        "Refusing to add a second privileged account without a deliberate check. " +
        "If this is intended, re-run after confirming, or create it via SQL.",
    );
    process.exit(1);
  }

  await prisma.adminUser.create({
    data: {
      email,
      name,
      role: "admin",
      passwordHash: await bcrypt.hash(password, 12),
    },
  });

  console.log(`Admin created: ${email}`);
  console.log(
    "The /setup endpoint is now closed (it refuses once any admin exists).",
  );
  console.log("Change this password after first login.");
} catch (error) {
  console.error("Failed to create admin:", error?.message || error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
