/**
 * One-off backfill / rollback for the inline-script metafield.
 *
 * The dashboard loader already heals each store the next time its merchant opens
 * the app (reconcileScriptMetafield). Run this to cover every active store at
 * once instead of waiting for that.
 *
 *   npx tsx --env-file=.env scripts/backfill-script-metafield.ts            # sync all active stores
 *   npx tsx --env-file=.env scripts/backfill-script-metafield.ts --dry-run  # list what would change
 *   npx tsx --env-file=.env scripts/backfill-script-metafield.ts --clear    # ROLLBACK: remove every inline copy
 *
 * Needs the same env as the app (DATABASE_URL, SHOPIFY_API_KEY, SHOPIFY_API_SECRET,
 * SCOPES, SHOPIFY_APP_URL). Stores without a usable offline session are reported
 * and keep whatever inline script they had (or none).
 *
 * --clear turns the script OFF in every store: the embed prints nothing when the
 * metafields are blank (there is no <script src> fallback any more).
 */
import prisma from "../app/db.server";
import {
  clearScriptMetafield,
  reconcileScriptMetafield,
} from "../app/lib/script-metafield.server";

const CONCURRENCY = 3;
const DELAY_BETWEEN_BATCHES_MS = 500;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const clearMode = args.has("--clear");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const stores = await prisma.store.findMany({
    where: clearMode
      ? { performanceScript: { is: { metafieldHash: { not: null } } } }
      : { isActive: true },
    select: { shopDomain: true },
    orderBy: { shopDomain: "asc" },
  });

  console.log(
    `${clearMode ? "Clearing" : "Syncing"} ${stores.length} store(s)${dryRun ? " (dry run)" : ""}`,
  );

  const counts: Record<string, number> = {};
  const failures: string[] = [];

  for (let i = 0; i < stores.length; i += CONCURRENCY) {
    const batch = stores.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async ({ shopDomain }: { shopDomain: string }) => {
        if (dryRun) {
          console.log(`  would ${clearMode ? "clear" : "reconcile"} ${shopDomain}`);
          counts.dryRun = (counts.dryRun ?? 0) + 1;
          return;
        }
        const result = clearMode
          ? await clearScriptMetafield(shopDomain)
          : await reconcileScriptMetafield(shopDomain, { force: true });
        counts[result.status] = (counts[result.status] ?? 0) + 1;
        if (result.status === "failed") failures.push(`${shopDomain}: ${result.reason}`);
        console.log(`  ${shopDomain}: ${result.status}`);
      }),
    );
    if (i + CONCURRENCY < stores.length) await sleep(DELAY_BETWEEN_BATCHES_MS);
  }

  console.log("\nSummary:", counts);
  if (failures.length) {
    console.log("Failures (these stores keep their previous inline script, or none):");
    failures.forEach((f) => console.log(`  ${f}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
