/**
 * Mimics merchant "Run audit" (handleStartAudit) with force to bypass shop cooldown.
 * With AUDIT_USE_DB_QUEUE=true, start npm run worker to drain the job.
 */
import prisma from "../app/db.server";
import { resolveShopAdmin } from "../app/lib/internal-shop-session.server";
import { startAuditForStore } from "../app/lib/audit-runner.server";
import { isAppEmbedEnabled, getSelectedThemeId } from "../app/lib/theme-embed.server";

const shop = process.argv[2] || "rishabh-dev-store-mdqu0epm.myshopify.com";

const adminRes = await resolveShopAdmin(shop);
if (!adminRes.ok) {
  console.error("No admin session:", adminRes.error);
  process.exit(1);
}

const store = await prisma.store.findUnique({
  where: { shopDomain: shop },
  select: { configs: { select: { appEnabled: true, auditRunning: true }, take: 1 } },
});
const cfg = store?.configs?.[0];
if (!cfg?.appEnabled) {
  console.error("app_disabled");
  process.exit(1);
}
if (cfg.auditRunning) {
  console.error("already_running");
  process.exit(1);
}

const themeId = await getSelectedThemeId(shop).catch(() => null);
const embed = await isAppEmbedEnabled(adminRes.admin, undefined, themeId);
if (embed !== true) {
  console.error(JSON.stringify({ ok: false, error: "extension_required", embed, themeId }));
  process.exit(1);
}

const { started, reason, waiting } = await startAuditForStore(adminRes.admin, shop, {
  trigger: "merchant",
  force: true,
});
console.log(JSON.stringify({ ok: started, reason, waiting, themeId, embed }, null, 2));
await prisma.$disconnect();
process.exit(started ? 0 : 1);
