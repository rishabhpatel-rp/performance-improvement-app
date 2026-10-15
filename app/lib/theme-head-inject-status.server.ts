import prisma from "../db.server";
import {
  ensureThemeHeadInlineScript,
  type ThemeHeadInjectResult,
  type AdminGraphQL,
} from "./theme-head-inject.server";
import {
  isThemeFilesExemptDenied,
  THEME_HEAD_INJECT_STATUS,
} from "./theme-head-inject-utils.js";

export { isThemeFilesExemptDenied, THEME_HEAD_INJECT_STATUS };

const EXEMPT_DENIED_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

async function getInjectState(shopDomain: string) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
    select: {
      configs: {
        select: {
          id: true,
          themeHeadInjectStatus: true,
          themeHeadInjectAttemptedAt: true,
        },
        orderBy: { updatedAt: "desc" },
        take: 1,
      },
    },
  });
  return store?.configs[0] ?? null;
}

export async function shouldSkipThemeHeadInject(shopDomain: string): Promise<boolean> {
  const cfg = await getInjectState(shopDomain);
  if (!cfg) return false;
  if (cfg.themeHeadInjectStatus === THEME_HEAD_INJECT_STATUS.INJECTED) {
    return true;
  }
  if (cfg.themeHeadInjectStatus === THEME_HEAD_INJECT_STATUS.EXEMPT_DENIED) {
    const at = cfg.themeHeadInjectAttemptedAt?.getTime() ?? 0;
    return Date.now() - at < EXEMPT_DENIED_COOLDOWN_MS;
  }
  return false;
}

function resultToStatus(result: ThemeHeadInjectResult): {
  status: string;
  error: string | null;
} {
  if (result.status === "injected") {
    return { status: THEME_HEAD_INJECT_STATUS.INJECTED, error: null };
  }
  if (result.status === "skipped") {
    return { status: THEME_HEAD_INJECT_STATUS.SKIPPED, error: result.reason };
  }
  if (result.status === "failed") {
    if (isThemeFilesExemptDenied(result.reason)) {
      return { status: THEME_HEAD_INJECT_STATUS.EXEMPT_DENIED, error: result.reason };
    }
    return { status: THEME_HEAD_INJECT_STATUS.ERROR, error: result.reason };
  }
  return { status: THEME_HEAD_INJECT_STATUS.ERROR, error: "unknown" };
}

async function persistInjectStatus(
  configId: string,
  status: string,
  error: string | null,
): Promise<void> {
  await prisma.storeConfig.update({
    where: { id: configId },
    data: {
      themeHeadInjectStatus: status,
      themeHeadInjectAttemptedAt: new Date(),
      themeHeadInjectError: error,
    },
  });
}

/**
 * Run theme head injection when allowed; persist outcome on StoreConfig.
 */
export async function attemptThemeHeadInject(
  shopDomain: string,
  admin: AdminGraphQL,
  options: { force?: boolean } = {},
): Promise<ThemeHeadInjectResult> {
  const cfg = await getInjectState(shopDomain);
  if (
    !options.force &&
    cfg &&
    (await shouldSkipThemeHeadInject(shopDomain))
  ) {
    const reason =
      cfg.themeHeadInjectStatus === THEME_HEAD_INJECT_STATUS.INJECTED
        ? "already injected"
        : "exempt_denied cooldown";
    return { status: "skipped", reason };
  }

  const result = await ensureThemeHeadInlineScript(admin, shopDomain);
  if (cfg?.id) {
    const { status, error } = resultToStatus(result);
    await persistInjectStatus(cfg.id, status, error);
  }
  return result;
}
