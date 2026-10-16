import { urlToCandidates } from "./audit-candidates";
import type { ScriptInventoryBlock, ScriptInventoryEntry } from "./audit-report-types";

export type InventoryReportInput = {
  deferArray: string[];
  neverDefer: string[];
  noiseDropped: string[];
  selfExcluded: string[];
  foldReasons: Record<string, string>;
  funnel?: unknown[];
  pagesAudited: string[];
};

type ResourceRow = {
  url: string;
  transferSize?: number;
  encodedBodySize?: number;
  decodedBodySize?: number;
  duration?: number;
  pathname: string;
  requestOrder?: number;
  startTime?: number;
};

function isHomePath(pathname: string) {
  return pathname === "/" || pathname === "/index";
}

function tokensFromUrl(rawUrl: string, pageUrl: string): string[] {
  const b = urlToCandidates(rawUrl, pageUrl);
  return [...new Set([...b.kept, ...b.neverDefer, ...b.noise, ...b.self])];
}

function hostOf(rawUrl: string): string | undefined {
  try {
    const host = new URL(rawUrl).hostname;
    return host || undefined;
  } catch {
    return undefined;
  }
}

function applyResourceToEntry(
  entry: ScriptInventoryEntry,
  row: ResourceRow,
  pathname: string,
) {
  if (!entry.pages.includes(pathname)) entry.pages.push(pathname);
  const sizes = [row.transferSize, row.encodedBodySize, row.decodedBodySize];
  const rawBytes = sizes.reduce(
    (max, n) => (typeof n === "number" && n > max ? n : max),
    0,
  );
  if (rawBytes > 0) entry.bytes = Math.max(entry.bytes ?? 0, rawBytes);
  if (typeof row.encodedBodySize === "number" && row.encodedBodySize > 0) {
    entry.encodedBytes = Math.max(entry.encodedBytes ?? 0, row.encodedBodySize);
  }
  if (typeof row.duration === "number" && row.duration > 0) {
    entry.durationMs = Math.max(entry.durationMs ?? 0, row.duration);
  }
  const host = hostOf(row.url);
  if (host && !entry.domain) entry.domain = host;
  if (row.requestOrder != null) {
    const onHome = isHomePath(pathname);
    if (onHome) {
      if (
        entry.homeRequestOrder == null ||
        row.requestOrder < entry.homeRequestOrder
      ) {
        entry.homeRequestOrder = row.requestOrder;
        if (row.startTime != null) entry.homeStartMs = row.startTime;
      }
    } else if (entry.homeRequestOrder == null) {
      entry.homeRequestOrder = row.requestOrder;
      if (row.startTime != null) entry.homeStartMs = row.startTime;
    }
  }
}

/** Merge resource timings into inventory; classify from final audit lists. */
export function buildScriptInventory(
  report: InventoryReportInput,
  resourcesByPath: Record<string, ResourceRow[]>,
): ScriptInventoryBlock {
  const deferSet = new Set(report.deferArray);
  const never = new Set(report.neverDefer);
  const noise = new Set(report.noiseDropped);
  const self = new Set(report.selfExcluded);
  const foldProt = new Set(Object.keys(report.foldReasons || {}));

  const byToken = new Map<string, ScriptInventoryEntry>();

  const ensureEntry = (token: string): ScriptInventoryEntry => {
    let entry = byToken.get(token);
    if (!entry) {
      let status: ScriptInventoryEntry["status"] = "candidate";
      const reasons: string[] = [];
      if (deferSet.has(token)) {
        status = "deferred";
        reasons.push("emitted-defer");
      } else if (never.has(token)) {
        status = "never";
        reasons.push("never-defer");
      } else if (noise.has(token)) {
        status = "noise";
        reasons.push("noise");
      } else if (self.has(token)) {
        status = "self";
        reasons.push("self-script");
      } else if (foldProt.has(token)) {
        status = "protected";
        reasons.push(report.foldReasons[token] || "fold");
      } else {
        status = "protected";
        reasons.push("not-emitted");
      }
      entry = { token, status, reasons, pages: [] };
      byToken.set(token, entry);
    }
    return entry;
  };

  for (const [pathname, rows] of Object.entries(resourcesByPath)) {
    const pageUrl = `https://shop.test${pathname}`;
    for (const row of rows) {
      const tokens = tokensFromUrl(row.url, pageUrl);
      if (!tokens.length) continue;
      for (const token of tokens) {
        applyResourceToEntry(ensureEntry(token), row, pathname);
      }
    }
  }

  for (const token of deferSet) {
    if (!byToken.has(token)) {
      byToken.set(token, {
        token,
        status: "deferred",
        reasons: ["emitted-defer"],
        pages: [...report.pagesAudited],
      });
    }
  }

  const byTokenList = [...byToken.values()].sort(
    (a, b) => (b.bytes ?? 0) - (a.bytes ?? 0),
  );

  let thirdPartyBytes = 0;
  let scriptRequests = 0;
  for (const rows of Object.values(resourcesByPath)) {
    scriptRequests += rows.length;
    for (const r of rows) thirdPartyBytes += r.transferSize ?? r.encodedBodySize ?? 0;
  }

  return {
    byToken: byTokenList,
    totals: {
      scriptRequests,
      thirdPartyBytes,
      deferredTokenCount: deferSet.size,
      protectedTokenCount: byTokenList.filter((e) => e.status === "protected").length,
    },
  };
}
