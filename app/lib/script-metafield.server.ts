import prisma from "../db.server";
import { unauthenticated } from "../shopify.server";
import { withShopifyTimeout } from "./shopify-timeout.server";
import {
  deleteScriptMetafield,
  ensureScriptDefinition,
  planMetafieldSync,
  writeScriptMetafield,
} from "./script-inline";
import { attemptThemeHeadInject } from "./theme-head-inject-status.server";

/**
 * Keeps the shop metafield (rendered inline by the theme app embed) in step
 * with `PerformanceScript.deferScript`.
 *
 * The DB row is the source of truth. Every function here reads the CURRENT row
 * (not a value passed in by the caller), so racing rebuilds converge on the
 * latest script, and none of them throws: a failed sync only means the shop
 * keeps its previous inline script until the next
 * `reconcileScriptMetafield`, which runs whenever the merchant opens the app.
 */

export type SyncResult =
  | { status: "written"; hash: string }
  | { status: "cleared"; reason: string }
  | { status: "noop"; reason: string }
  | { status: "failed"; reason: string };

const SYNC_CALL_TIMEOUT_MS = 10_000;

const chains = new Map<string, Promise<unknown>>();

function serialize<T>(key: string, task: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  chains.set(key, next);
  void next
    .finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    })
    .catch(() => undefined);
  return next;
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await withShopifyTimeout(fn(), label, SYNC_CALL_TIMEOUT_MS);
  } catch (first) {
    console.warn(
      `[script-metafield] ${label} failed, retrying once:`,
      first instanceof Error ? first.message : first,
    );
    return await withShopifyTimeout(fn(), label, SYNC_CALL_TIMEOUT_MS);
  }
}

async function adminFor(shopDomain: string) {
  const { admin } = await unauthenticated.admin(shopDomain);
  return admin;
}

async function logThemeHeadInjectResult(
  shopDomain: string,
  result: Awaited<ReturnType<typeof attemptThemeHeadInject>>,
): Promise<void> {
  if (result.status === "injected") {
    console.log(`[script-metafield] theme head inject ok for ${shopDomain}`);
  } else if (result.status === "failed") {
    console.warn(
      `[script-metafield] theme head inject for ${shopDomain}: ${result.reason}`,
    );
  }
}

export function syncScriptMetafield(shopDomain: string): Promise<SyncResult> {
  return serialize(shopDomain, async (): Promise<SyncResult> => {
    try {
      const store = await prisma.store.findUnique({
        where: { shopDomain },
        select: {
          id: true,
          isActive: true,
          configs: {
            select: { appEnabled: true },
            orderBy: { updatedAt: "desc" },
            take: 1,
          },
          performanceScript: {
            select: {
              deferScript: true,
              scriptHash: true,
              metafieldHash: true,
              metafieldSyncedAt: true,
            },
          },
        },
      });
      if (!store) return { status: "noop", reason: "unknown store" };

      const row = store.performanceScript;
      const active = store.isActive && store.configs[0]?.appEnabled === true;

      if (!store.isActive) {
        if (row?.metafieldHash) {
          await prisma.performanceScript.updateMany({
            where: { storeId: store.id },
            data: { metafieldHash: null, metafieldSyncedAt: new Date() },
          });
        }
        return { status: "noop", reason: "store inactive; metafield goes with the app" };
      }

      const plan = planMetafieldSync({
        script: active ? (row?.deferScript ?? "") : "",
        scriptHash: row?.scriptHash ?? null,
        metafieldHash: row?.metafieldHash ?? null,
      });

      if (plan.action === "noop") return { status: "noop", reason: plan.reason };

      const admin = await adminFor(shopDomain);

      if (plan.action === "write") {
        const script = row?.deferScript ?? "";
        await withShopifyTimeout(
          ensureScriptDefinition(admin),
          "ensureScriptDefinition",
          SYNC_CALL_TIMEOUT_MS,
        ).catch(() => undefined);
        await withRetry("writeScriptMetafield", () =>
          writeScriptMetafield(admin, script),
        );
        await prisma.performanceScript.updateMany({
          where: { storeId: store.id },
          data: { metafieldHash: plan.hash, metafieldSyncedAt: new Date() },
        });
        console.log(
          `[script-metafield] wrote inline script for ${shopDomain} (${Buffer.byteLength(script)} bytes)`,
        );
        await logThemeHeadInjectResult(
          shopDomain,
          await attemptThemeHeadInject(shopDomain, admin),
        );
        return { status: "written", hash: plan.hash };
      }

      await withRetry("deleteScriptMetafield", () => deleteScriptMetafield(admin));
      await prisma.performanceScript.updateMany({
        where: { storeId: store.id },
        data: { metafieldHash: null, metafieldSyncedAt: new Date() },
      });
      console.log(`[script-metafield] cleared for ${shopDomain}: ${plan.reason}`);
      return { status: "cleared", reason: plan.reason };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[script-metafield] sync failed for ${shopDomain}:`, reason);
      return { status: "failed", reason };
    }
  });
}

export function clearScriptMetafield(shopDomain: string): Promise<SyncResult> {
  return serialize(shopDomain, async (): Promise<SyncResult> => {
    try {
      const admin = await adminFor(shopDomain);
      await withRetry("deleteScriptMetafield", () => deleteScriptMetafield(admin));
      await prisma.performanceScript.updateMany({
        where: { store: { shopDomain } },
        data: { metafieldHash: null, metafieldSyncedAt: new Date() },
      });
      return { status: "cleared", reason: "explicit clear" };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[script-metafield] clear failed for ${shopDomain}:`, reason);
      return { status: "failed", reason };
    }
  });
}

const RECONCILE_COOLDOWN_MS = 60_000;
const lastReconcile = new Map<string, number>();

export async function reconcileScriptMetafield(
  shopDomain: string,
  options: { force?: boolean } = {},
): Promise<SyncResult> {
  const now = Date.now();
  const last = lastReconcile.get(shopDomain) ?? 0;
  if (!options.force && now - last < RECONCILE_COOLDOWN_MS) {
    return { status: "noop", reason: "reconciled recently" };
  }
  lastReconcile.set(shopDomain, now);

  try {
    const store = await prisma.store.findUnique({
      where: { shopDomain },
      select: {
        isActive: true,
        configs: {
          select: { appEnabled: true },
          orderBy: { updatedAt: "desc" },
          take: 1,
        },
        performanceScript: { select: { deferScript: true } },
      },
    });
    if (!store) return { status: "noop", reason: "unknown store" };

    const active = store.isActive && store.configs[0]?.appEnabled === true;
    if (active && !store.performanceScript?.deferScript) {
      const { rebuildPerformanceScript } = await import("./performance-script.server");
      await rebuildPerformanceScript(shopDomain);
      return { status: "noop", reason: "rebuilt missing script" };
    }

    const syncResult = await syncScriptMetafield(shopDomain);

    if (active && store.performanceScript?.deferScript) {
      try {
        const admin = await adminFor(shopDomain);
        await logThemeHeadInjectResult(
          shopDomain,
          await attemptThemeHeadInject(shopDomain, admin),
        );
      } catch (err) {
        console.warn(
          `[script-metafield] theme head inject on reconcile for ${shopDomain}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
    return syncResult;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[script-metafield] reconcile failed for ${shopDomain}:`, reason);
    return { status: "failed", reason };
  }
}
