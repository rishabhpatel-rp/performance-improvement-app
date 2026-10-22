import prisma from "../db.server";
import {
  rebuildPerformanceScript,
  readStringArray,
} from "./performance-script.server";
import type { HiddenAuditResult } from "./audit.server";
import { applyFoldPolicy } from "./audit-fold-policy.server";
import {
  applyHideSelectorHygiene,
  emptyHideTemplateBuckets,
  filterHideTemplateBuckets,
} from "./audit-hide-safety.server";
import { schedulePsiAfterAudit } from "./psi-scheduler.server";
import { templateBucketsToStorePatch } from "./template-script-config";
const DEFAULT_STATIC_DEFER = ["wpm", "gtm"];

export type AuditReport = HiddenAuditResult;

export async function saveAuditReport(
  shopDomain: string,
  report: AuditReport,
  status = "completed",
  details?: string,
  activeJobId?: string,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });

  if (!store) {
    console.warn(`[saveAuditReport] No store found for ${shopDomain}. Skipped.`);
    return null;
  }

  const completed = status === "completed";

  const current = await prisma.storeConfig.findUnique({
    where: { storeId: store.id },
  });
  const deferOn = current?.auditDeferArrayEnabled ?? true;
  const hideOn = current?.auditHideSelectorsEnabled ?? true;
  const activeDefer = deferOn ? report.deferArray : [];

  const hygiene = applyHideSelectorHygiene(report.hideSelectors ?? []);
  const foldPolicy = applyFoldPolicy(
    hygiene.hideSelectors,
    report.foldAssertion ?? { ok: true, violations: [], pagesChecked: 0 },
  );
  const hideForStore = hideOn ? foldPolicy.hideSelectors : [];
  const reportWarnings = [
    ...(report.warnings ?? []),
    ...hygiene.warnings,
    ...foldPolicy.warnings,
  ];
  const reportToPersist: AuditReport = {
    ...report,
    hideSelectors: hideForStore,
    warnings: reportWarnings,
  };

  const runState = completed
    ? {
        auditComplete: false,
        auditRunning: true,
        auditFailed: false,
        auditError: null,
      }
    : {
        auditComplete: false,
        auditRunning: false,
        auditFailed: true,
        auditError: details ?? null,
      };

  let templatePatch: Record<string, string[]> = {};
  if (report.templateBuckets?.defer && report.templateBuckets?.hide) {
    const hideBuckets =
      hideOn && foldPolicy.ok
        ? filterHideTemplateBuckets(report.templateBuckets.hide, hideForStore)
        : emptyHideTemplateBuckets();
    templatePatch = templateBucketsToStorePatch(
      report.templateBuckets.defer,
      hideBuckets,
    );
    if (!deferOn) {
      for (const key of Object.keys(templatePatch)) {
        if (key.startsWith("auditDefer")) templatePatch[key] = [];
      }
    }
    if (!hideOn) {
      for (const key of Object.keys(templatePatch)) {
        if (key.startsWith("auditHide")) templatePatch[key] = [];
      }
    }
  }

  const reportPatch = {
    ...runState,
    lastAuditAt: new Date(),
    auditDeferArray: deferOn ? templatePatch.auditDeferArray ?? activeDefer : [],
    auditHideSelectors: hideOn ? templatePatch.auditHideSelectors ?? hideForStore : [],
    ...(deferOn ? {} : { auditDeferArrayPreserved: report.deferArray }),
    ...(hideOn ? {} : { auditHideSelectorsPreserved: report.hideSelectors }),
    ...templatePatch,
  };

  if (activeJobId) {
    const wrote = await prisma.storeConfig.updateMany({
      where: { storeId: store.id, activeAuditJobId: activeJobId },
      data: reportPatch,
    });
    if (wrote.count === 0) {
      console.warn(
        `[saveAuditReport] skipped stale job ${activeJobId} for ${shopDomain}`,
      );
      return null;
    }
  } else {
    await prisma.storeConfig.upsert({
      where: { storeId: store.id },
      create: {
        storeId: store.id,
        appEnabled: false,
        script1Enabled: false,
        script2Enabled: false,
        script3Enabled: false,
        debugMode: false,
        scriptTitles: [],
        auditDeferArrayPreserved: deferOn ? [] : report.deferArray,
        auditHideSelectorsPreserved: hideOn ? [] : report.hideSelectors,
        staticDeferDefaults: DEFAULT_STATIC_DEFER,
        ...reportPatch,
      },
      update: reportPatch,
    });
  }

  await prisma.auditLog.create({
    data: {
      domain: shopDomain,
      audit_type: "auto-audit",
      audit_data: reportToPersist,
      status,
      details,
    },
  });

  await rebuildPerformanceScript(shopDomain);

  if (completed) {
    const finished = await prisma.storeConfig.updateMany({
      where: activeJobId
        ? { storeId: store.id, activeAuditJobId: activeJobId }
        : { storeId: store.id },
      data: { auditComplete: true, auditRunning: false, auditPhase: null },
    });
    if (finished.count === 0) return { ok: true };
    const pageUrls = (report.pagesAudited || []).map((path) => {
      try {
        return new URL(path, `https://${shopDomain}`).href;
      } catch {
        return `https://${shopDomain}${path.startsWith("/") ? path : `/${path}`}`;
      }
    });
    schedulePsiAfterAudit(
      shopDomain,
      pageUrls.length ? pageUrls : [`https://${shopDomain}/`],
      current?.storefrontPassword ?? null,
    );
    const { healStoreTemplateFromReport } = await import(
      "./heal-template-config.server"
    );
    void healStoreTemplateFromReport(shopDomain, report);
  }

  return { ok: true };
}

export type AuditArrayPatch = Record<string, string[] | number | undefined>;

export async function updateAuditArrays(
  shopDomain: string,
  patch: AuditArrayPatch,
) {
  const store = await prisma.store.findUnique({
    where: { shopDomain },
  });
  if (!store) {
    console.warn(
      `[updateAuditArrays] No store found for ${shopDomain}. Skipped.`,
    );
    return null;
  }

  const createData: AuditArrayPatch &
    Pick<AuditArrayPatch, "staticDeferDefaults"> = {
    auditDeferArray: patch.auditDeferArray ?? [],
    auditHideSelectors: patch.auditHideSelectors ?? [],
    staticDeferDefaults: patch.staticDeferDefaults ?? DEFAULT_STATIC_DEFER,
    firstUserDelayScripts: patch.firstUserDelayScripts ?? ["wpm","gtm"],
    firstUserDelayMs: patch.firstUserDelayMs ?? 12000,
    everyTimeDelayMs: patch.everyTimeDelayMs ?? 6000,
  };

  const result = await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      storeId: store.id,
      appEnabled: false,
      script1Enabled: false,
      script2Enabled: false,
      script3Enabled: false,
      debugMode: false,
      scriptTitles: [],
      ...createData,
    },
    update: Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    ),
  });

  await rebuildPerformanceScript(shopDomain);
  return result;
}

type AuditField =
  | "auditDeferArray"
  | "auditHideSelectors"
  | "staticDeferDefaults"
  | "firstUserDelayScripts";

const TOGGLE_FIELD_MAP: Record<
  AuditField,
  {
    enabledKey:
      | "auditDeferArrayEnabled"
      | "auditHideSelectorsEnabled"
      | "staticDeferDefaultsEnabled"
      | "firstUserDelayScriptsEnabled";
    preservedKey:
      | "auditDeferArrayPreserved"
      | "auditHideSelectorsPreserved"
      | "staticDeferDefaultsPreserved"
      | "firstUserDelayScriptsPreserved";
  }
> = {
  auditDeferArray: {
    enabledKey: "auditDeferArrayEnabled",
    preservedKey: "auditDeferArrayPreserved",
  },
  auditHideSelectors: {
    enabledKey: "auditHideSelectorsEnabled",
    preservedKey: "auditHideSelectorsPreserved",
  },
  staticDeferDefaults: {
    enabledKey: "staticDeferDefaultsEnabled",
    preservedKey: "staticDeferDefaultsPreserved",
  },
  firstUserDelayScripts: {
    enabledKey: "firstUserDelayScriptsEnabled",
    preservedKey: "firstUserDelayScriptsPreserved",
  },
};

export async function updateAuditFieldToggle(
  shopDomain: string,
  field: AuditField,
  enabled: boolean,
) {
  const store = await prisma.store.findUnique({ where: { shopDomain } });
  if (!store) return null;

  const current = await prisma.storeConfig.findUnique({
    where: { storeId: store.id },
  });

  const { enabledKey, preservedKey } = TOGGLE_FIELD_MAP[field];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const active = readStringArray(current ? (current as any)[field] : undefined);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const preserved = readStringArray(current ? (current as any)[preservedKey] : undefined);

  const nextActive = enabled ? (preserved.length > 0 ? preserved : active) : [];
  const nextPreserved = enabled ? preserved : active;

  const seed = {
    storeId: store.id,
    appEnabled: false,
    script1Enabled: false,
    script2Enabled: false,
    script3Enabled: false,
    debugMode: false,
    scriptTitles: [],
  } as const;

  const result = await prisma.storeConfig.upsert({
    where: { storeId: store.id },
    create: {
      ...seed,
      [field]: nextActive,
      [enabledKey]: enabled,
      [preservedKey]: nextPreserved,
    },
    update: {
      [field]: nextActive,
      [enabledKey]: enabled,
      [preservedKey]: nextPreserved,
    },
  });

  await rebuildPerformanceScript(shopDomain);
  return result;
}
