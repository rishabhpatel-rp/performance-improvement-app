import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Previously this fell back to a hardcoded admin@performance-app.com /
  // admin123 account whenever the env vars were unset, so running `prisma db
  // seed` against a real database (e.g. by accident in a deploy pipeline)
  // silently created a known-credential admin login (REQUIREMENTS_AND_PLANS.md
  // R1 issue #6). The app already has a proper first-run flow for this (the
  // `/setup` page), so seeding is now opt-in: it requires both env vars to be
  // set explicitly, and refuses a weak password, rather than guessing a
  // "safe" default on the caller's behalf.
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || "Admin";

  if (!email || !password) {
    console.log(
      "SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — skipping admin seed. " +
        "Use the /setup page to create the first admin, or set both env vars " +
        "explicitly to seed one.",
    );
    return;
  }
  if (password.length < 12) {
    throw new Error(
      "SEED_ADMIN_PASSWORD must be at least 12 characters. Refusing to seed a weak admin password.",
    );
  }

  const existing = await prisma.adminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Admin user ${email} already exists. Skipping.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  await prisma.adminUser.create({
    data: {
      email,
      passwordHash,
      name,
      role: "admin",
    },
  });

  console.log(`Admin user created: ${email} / ${password}`);
  console.log("Change this password after first login.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
