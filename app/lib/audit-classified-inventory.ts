/** Classified token lists → one inventory row per script. No other imports, so
 *  node tests and the audit runner can both load it. */

type InventoryStatus = "deferred" | "protected" | "never" | "noise" | "self" | "candidate";

export type ClassifiedInventoryEntry = {
  token: string;
  status: InventoryStatus;
  reasons: string[];
  pages: string[];
  domain?: string;
};

function domainFromToken(token: string): string | undefined {
  const t = token.trim().toLowerCase();
  if (!t || t.includes("/") || /\.(m?js|css|json)$/i.test(t)) return undefined;
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(t)) return t;
  return undefined;
}

function tokenSeenOnPage(token: string, pageTokens: string[]): boolean {
  for (const raw of pageTokens) {
    if (raw === token) return true;
    const shorter = raw.length < token.length ? raw : token;
    const longer = raw.length < token.length ? token : raw;
    if (shorter.length >= 3 && longer.startsWith(shorter)) return true;
  }
  return false;
}

export function buildScriptInventoryFromClassified(report: {
  deferArray?: string[];
  neverDefer?: string[];
  noiseDropped?: string[];
  selfExcluded?: string[];
  foldReasons?: Record<string, string>;
  deferArrayByPage?: Record<string, string[]>;
}): {
  byToken: ClassifiedInventoryEntry[];
  totals: {
    scriptRequests: number;
    thirdPartyBytes: number;
    deferredTokenCount: number;
    protectedTokenCount: number;
  };
} {
  const pagesOf = new Map<string, string[]>();
  const pageEntries = Object.entries(report.deferArrayByPage || {});
  const remember = (token: string, path: string) => {
    const list = pagesOf.get(token) || [];
    if (!list.includes(path)) list.push(path);
    pagesOf.set(token, list);
  };
  for (const [path, tokens] of pageEntries) {
    for (const token of tokens || []) remember(token, path);
  }

  const byToken: ClassifiedInventoryEntry[] = [];
  const seen = new Set<string>();
  const push = (token: string, status: InventoryStatus, reason: string) => {
    const t = String(token || "").trim();
    if (!t || seen.has(t)) return;
    seen.add(t);
    const direct = pagesOf.get(t) || [];
    const pages = direct.length
      ? direct
      : status === "deferred"
        ? pageEntries
            .filter(([, tokens]) => tokenSeenOnPage(t, tokens || []))
            .map(([path]) => path)
        : [];
    byToken.push({
      token: t,
      status,
      reasons: [reason],
      pages,
      domain: domainFromToken(t),
    });
  };

  for (const token of report.deferArray || []) push(token, "deferred", "emitted-defer");
  for (const token of report.neverDefer || []) push(token, "never", "never-defer");
  for (const token of report.selfExcluded || []) push(token, "self", "self-script");
  for (const token of report.noiseDropped || []) push(token, "noise", "noise");
  for (const [token, reason] of Object.entries(report.foldReasons || {})) {
    push(token, "protected", reason || "fold");
  }

  return {
    byToken,
    totals: {
      scriptRequests: byToken.length,
      thirdPartyBytes: 0,
      deferredTokenCount: (report.deferArray || []).length,
      protectedTokenCount: byToken.filter((e) => e.status === "protected").length,
    },
  };
}
