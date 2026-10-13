import type { FieldVitalsSummary } from "./audit-report-types";

const PSI_ENDPOINT = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** Shown in Step 3 when PSI cannot run on a password store (no preview share link saved). */
export const PSI_SKIP_PASSWORD_STORE_NOTE =
  "PageSpeed Overview is unavailable while your storefront is password-protected. Remove the password in Shopify admin to see PageSpeed Insights scores here.";

export const PSI_PREVIEW_LOCK_SCREEN_NOTE =
  "Google analyzed the password page, not your theme — paste a fresh Share preview link in Step 1 (preview tokens expire). On pagespeed.web.dev you must choose Analyze with the original URL; PagePulse always sends the full preview URL to the API.";

export const PSI_PREVIEW_EXPIRED_NOTE =
  "Your theme preview link has expired. In the theme editor, open Share preview again and paste the new URL in Step 1.";

export function shouldSkipPsiFetch(
  isPasswordProtected: boolean | null | undefined,
): boolean {
  return isPasswordProtected === true;
}

export function psiReportLooksLikePasswordGate(json: PsiJson): boolean {
  const url = json.lighthouseResult?.requestedUrl;
  if (!url) return false;
  try {
    return /(^|\/)password\/?$/i.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

export type LighthouseCategoryScores = {
  performance?: number;
  accessibility?: number;
  bestPractices?: number;
  seo?: number;
};

export type LighthouseMetricDisplay = {
  fcpSec?: number;
  lcpSec?: number;
  tbtMs?: number;
  speedIndexSec?: number;
  cls?: number;
};

export type PsiLighthouseReport = FieldVitalsSummary & {
  categories?: LighthouseCategoryScores;
  metrics?: LighthouseMetricDisplay;
  strategy?: "mobile" | "desktop";
  analyzedUrl?: string;
};

type PsiJson = {
  loadingExperience?: {
    metrics?: {
      LARGEST_CONTENTFUL_PAINT_MS?: { percentile?: number };
      INTERACTION_TO_NEXT_PAINT?: { percentile?: number };
      CUMULATIVE_LAYOUT_SHIFT_SCORE?: { percentile?: number };
    };
    origin_fallback?: boolean;
  };
  lighthouseResult?: {
    categories?: Record<string, { score?: number }>;
    audits?: Record<
      string,
      { numericValue?: number; displayValue?: string; score?: number }
    >;
    requestedUrl?: string;
  };
};

function scorePct(cat?: { score?: number }) {
  return cat?.score != null ? Math.round(cat.score * 100) : undefined;
}

function auditMs(
  audits: Record<string, { numericValue?: number }> | undefined,
  id: string,
) {
  const v = audits?.[id]?.numericValue;
  return typeof v === "number" ? v : undefined;
}

export function parsePsiLighthouse(json: PsiJson): PsiLighthouseReport {
  const le = json.loadingExperience;
  const m = le?.metrics;
  const lh = json.lighthouseResult;
  const cats = lh?.categories;
  const audits = lh?.audits;

  const source: FieldVitalsSummary["source"] =
    le?.origin_fallback ? "origin" : m ? "url" : "none";

  const fcpMs = auditMs(audits, "first-contentful-paint");
  const lcpMs = auditMs(audits, "largest-contentful-paint") ?? m?.LARGEST_CONTENTFUL_PAINT_MS?.percentile;
  const tbtMs = auditMs(audits, "total-blocking-time");
  const siMs = auditMs(audits, "speed-index");
  const clsRaw = auditMs(audits, "cumulative-layout-shift");
  const clsField = m?.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile;

  return {
    source,
    lcp: lcpMs,
    inp: m?.INTERACTION_TO_NEXT_PAINT?.percentile,
    cls: clsRaw ?? clsField,
    lighthouseScore: scorePct(cats?.performance),
    fetchedAt: new Date().toISOString(),
    categories: {
      performance: scorePct(cats?.performance),
      accessibility: scorePct(cats?.accessibility),
      bestPractices: scorePct(cats?.["best-practices"]),
      seo: scorePct(cats?.seo),
    },
    metrics: {
      fcpSec: fcpMs != null ? fcpMs / 1000 : undefined,
      lcpSec: lcpMs != null ? lcpMs / 1000 : undefined,
      tbtMs,
      speedIndexSec: siMs != null ? siMs / 1000 : undefined,
      cls: clsRaw ?? (clsField != null ? clsField / 100 : undefined),
    },
    analyzedUrl: lh?.requestedUrl,
  };
}

export async function fetchPsiLighthouse(
  url: string,
  strategy: "mobile" | "desktop" = "mobile",
): Promise<PsiLighthouseReport> {
  const key = process.env.GOOGLE_PSI_API_KEY;
  if (!key) {
    return {
      source: "none",
      note: "PSI API key not configured on server.",
      strategy,
    };
  }

  const qs = new URLSearchParams({ url, strategy, key });
  for (const cat of ["performance", "accessibility", "best-practices", "seo"]) {
    qs.append("category", cat);
  }

  const res = await fetch(`${PSI_ENDPOINT}?${qs.toString()}`, {
    signal: AbortSignal.timeout(90_000),
  });

  if (res.status === 429) {
    const backoff = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    return {
      source: "none",
      backoffUntil: backoff.toISOString(),
      note: "Google quota — retry after backoff.",
      strategy,
    };
  }

  if (!res.ok) {
    return { source: "none", note: `PSI HTTP ${res.status}`, strategy };
  }

  const json = (await res.json()) as PsiJson;
  if (psiReportLooksLikePasswordGate(json)) {
    const sentPreview = new URL(url).searchParams.has("_bt");
    return {
      source: "none",
      note: sentPreview ? PSI_PREVIEW_LOCK_SCREEN_NOTE : PSI_SKIP_PASSWORD_STORE_NOTE,
      strategy,
      analyzedUrl: json.lighthouseResult?.requestedUrl ?? url,
    };
  }
  const parsed = parsePsiLighthouse(json);
  const analyzedUrl = parsed.analyzedUrl ?? url;
  if (
    new URL(url).searchParams.has("_bt") &&
    psiReportLooksLikePasswordGate({ lighthouseResult: { requestedUrl: analyzedUrl } })
  ) {
    return {
      source: "none",
      note: PSI_PREVIEW_LOCK_SCREEN_NOTE,
      strategy,
      analyzedUrl,
    };
  }
  return { ...parsed, strategy, analyzedUrl };
}

/** @deprecated use fetchPsiLighthouse */
export async function fetchPsiFieldVitals(
  url: string,
  strategy: "mobile" | "desktop" = "mobile",
): Promise<FieldVitalsSummary> {
  const r = await fetchPsiLighthouse(url, strategy);
  return r;
}

export function appendStorefrontPassword(url: string, password?: string | null) {
  if (!password?.trim()) return url;
  try {
    const u = new URL(url);
    u.searchParams.set("password", password.trim());
    return u.href;
  } catch {
    return url;
  }
}
