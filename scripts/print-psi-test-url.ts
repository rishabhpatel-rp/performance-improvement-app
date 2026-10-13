import prisma from "../app/db.server";
import { appendStorefrontPassword } from "../app/lib/psi.server";

const shop = process.argv[2] || "rishabh-dev-store-mdqu0epm.myshopify.com";

const store = await prisma.store.findUnique({
  where: { shopDomain: shop },
  select: {
    configs: { select: { storefrontPassword: true, isPasswordProtected: true } },
  },
});
const pw = store?.configs?.[0]?.storefrontPassword;
const base = `https://${shop}/`;
const psiUrl = appendStorefrontPassword(base, pw);

console.log(
  "storefrontPassword saved in DB:",
  pw ? `yes (${pw.length} chars)` : "NO — save password in Step 1 first",
);
console.log("");
if (store?.configs?.[0]?.isPasswordProtected) {
  console.log(
    "NOTE: This store is password-protected. PageSpeed Insights will analyze the lock screen, not your theme.",
  );
  console.log("PagePulse skips PSI for such stores; use the lab metrics in Step 3 instead.");
  console.log("");
}
console.log("Paste into https://pagespeed.web.dev/ (expect lock-screen scores if protected):");
console.log(psiUrl);

const snap = await prisma.psiSnapshot.findFirst({
  where: { shopDomain: shop },
  orderBy: { fetchedAt: "desc" },
  select: { lighthouseScore: true, fetchedAt: true, rawJson: true },
});
if (snap) {
  const analyzed = (snap.rawJson as { analyzedUrl?: string })?.analyzedUrl;
  console.log("");
  console.log(
    `Last app PSI: perf=${snap.lighthouseScore ?? "—"} at ${snap.fetchedAt?.toISOString() ?? "?"}`,
  );
  if (analyzed) console.log(`Google analyzedUrl: ${analyzed}`);
}

await prisma.$disconnect();
