import { createHash } from "node:crypto";
import prisma from "../db.server";
import { buildHiddenCss, generateDeferredScript } from "./script-generator";

/**
 * Safely coerce a Prisma `Json` value (or any unknown) into a string array.
 * Returns `[]` when the value is not a JSON array of strings. Avoids
 * trusting raw `JsonValue` from the DB.
 */
export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((x): x is string => typeof x === "string");
}

export interface BuiltPerformanceScript {
  deferScript: string; // final obfuscated JS ("" when the app is off)
  hiddenCss: string;
  scriptHash: string;
  scriptBuiltAt: Date;
}

/**
 * Obfuscation is CPU-heavy (~0.7 s), so it runs here — once, whenever the
 * inputs change — and the result is stored in `PerformanceScript.deferScript`.
 * The storefront proxy route only reads that column.
 *
 * Inputs mirror the Step 2 cards: each list only counts while its own
 * `*Enabled` toggle is ON. Returns the row, or null when the store is unknown
 * or the build fails (failures are logged, never thrown, so callers such as
 * "save audit arrays" don't fail because of a rebuild; the proxy route
 * lazily rebuilds a missing script).
 */
export async function rebuildPerformanceScript(
  shopDomain: string,
): Promise<BuiltPerformanceScript | null> {
  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
      include: { configs: { orderBy: { updatedAt: "desc" }, take: 1 } },
    });
    if (!store) return null;

    const config = store.configs[0];
    const active = store.isActive && Boolean(config?.appEnabled);

    let deferScript = "";
    let hiddenCss = "";

    if (active && config) {
      const hideSelectors = config.auditHideSelectorsEnabled
        ? readStringArray(config.auditHideSelectors)
        : [];

      deferScript = generateDeferredScript({
        interactionGatedScripts: config.auditDeferArrayEnabled
          ? readStringArray(config.auditDeferArray)
          : [],
        firstVisitDelayedScripts: config.firstUserDelayScriptsEnabled
          ? readStringArray(config.firstUserDelayScripts)
          : [],
        everyLoadDelayedScripts: config.staticDeferDefaultsEnabled
          ? readStringArray(config.staticDeferDefaults)
          : [],
        firstVisitDelayMs: config.firstUserDelayMs ?? 12000,
        everyLoadDelayMs: config.everyTimeDelayMs ?? 6000,
        hideSelectors,
      });
      hiddenCss = buildHiddenCss(hideSelectors);
    }

    const built: BuiltPerformanceScript = {
      deferScript,
      hiddenCss,
      scriptHash: createHash("sha256").update(deferScript).digest("hex"),
      scriptBuiltAt: new Date(),
    };

    await prisma.performanceScript.upsert({
      where: { storeId: store.id },
      create: { storeId: store.id, ...built },
      update: built,
    });

    return built;
  } catch (err) {
    console.error(
      `[performance-script] Rebuild failed for ${shopDomain}:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}
