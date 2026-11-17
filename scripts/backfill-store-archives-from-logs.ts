/**
 * One-time / ops backfill: create thin StoreArchive rows from PM2 app logs
 * for shops that were hard-deleted by shop/redact before StoreArchive existed.
 *
 * Usage (on live host, from merchant app root):
 *   DRY_RUN=1 npx tsx scripts/backfill-store-archives-from-logs.ts [logfile]
 *   npx tsx scripts/backfill-store-archives-from-logs.ts /var/www/pagepulsespeed/.pm2/logs/performance-improvement-app-out.log
 *
 * Requires DATABASE_URL and a migrated StoreArchive table.
 */
import { readFileSync, existsSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const DRY_RUN = process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true";

const DEFAULT_LOG =
  "/var/www/pagepulsespeed/.pm2/logs/performance-improvement-app-out.log";

function mainLogPath() {
  return process.argv[2] || process.env.PAGEPULSE_APP_OUT_LOG || DEFAULT_LOG;
}

type Event = { kind: "uninstall" | "redact"; shopDomain: string; line: number };

function parseEvents(text: string): Event[] {
  const events: Event[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m = line.match(
      /\[uninstalled\] Store marked as inactive:\s*([a-z0-9][a-z0-9.-]*\.myshopify\.com)/i,
    );
    if (m) {
      events.push({ kind: "uninstall", shopDomain: m[1].toLowerCase(), line: i + 1 });
      continue;
    }
    m = line.match(
      /\[shop\/redact\] Erased shop data for\s*([a-z0-9][a-z0-9.-]*\.myshopify\.com)/i,
    );
    if (m) {
      events.push({ kind: "redact", shopDomain: m[1].toLowerCase(), line: i + 1 });
    }
    m = line.match(
      /\[shop\/redact\] Archived then erased shop data for\s*([a-z0-9][a-z0-9.-]*\.myshopify\.com)/i,
    );
    if (m) {
      events.push({ kind: "redact", shopDomain: m[1].toLowerCase(), line: i + 1 });
    }
  }
  return events;
}

async function run() {
  const logPath = mainLogPath();
  if (!existsSync(logPath)) {
    console.error(`Log file not found: ${logPath}`);
    process.exit(1);
  }

  const text = readFileSync(logPath, "utf8");
  const events = parseEvents(text);
  const byShop = new Map<string, Event[]>();
  for (const ev of events) {
    const list = byShop.get(ev.shopDomain) ?? [];
    list.push(ev);
    byShop.set(ev.shopDomain, list);
  }

  console.log(
    `Parsed ${events.length} events across ${byShop.size} shops from ${logPath}`,
  );
  console.log(DRY_RUN ? "DRY_RUN=1 — no writes" : "Applying inserts…");

  let inserted = 0;
  let skipped = 0;

  for (const [shopDomain, shopEvents] of byShop) {
    const redacts = shopEvents.filter((e) => e.kind === "redact");
    if (redacts.length === 0) {
      skipped++;
      continue;
    }

    const existing = await prisma.storeArchive.findFirst({
      where: {
        shopDomain,
        reason: { in: ["shop_redact", "pm2_log_backfill"] },
      },
      select: { id: true },
    });
    if (existing) {
      console.log(`skip ${shopDomain}: archive already exists (${existing.id})`);
      skipped++;
      continue;
    }

    const live = await prisma.store.findUnique({
      where: { shopDomain },
      select: { id: true },
    });

    const snapshot = {
      partial: true,
      source: "pm2_log_backfill",
      logPath,
      events: shopEvents.map((e) => ({
        kind: e.kind,
        line: e.line,
      })),
      note: live
        ? "Shop currently has a live Store row (likely reinstalled after redact)."
        : "No live Store row; original data was hard-deleted before StoreArchive existed.",
    };

    if (DRY_RUN) {
      console.log(`[dry-run] would insert archive for ${shopDomain}`, snapshot);
      inserted++;
      continue;
    }

    const row = await prisma.storeArchive.create({
      data: {
        shopDomain,
        snapshot,
        reason: "pm2_log_backfill",
        actorEmail: null,
        redactedAt: new Date(),
      },
    });
    console.log(`inserted ${shopDomain} → ${row.id}`);
    inserted++;
  }

  console.log(`Done. inserted=${inserted} skipped=${skipped}`);
}

run()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
