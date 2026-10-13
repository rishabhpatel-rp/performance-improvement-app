#!/usr/bin/env node
/**
 * Soak helper (AUDIT-SYSTEM-OCT-12 §10). Requires tsx and a running Postgres.
 *
 *   npx tsx --env-file=.env scripts/audit-soak.mjs shop.myshopify.com 3
 */
console.error(
  "Run: npx tsx --env-file=.env scripts/audit-soak.ts <shopDomain> [count]",
);
process.exit(1);
