/** Shared audit report shapes (AUDIT-SYSTEM-OCT-12). Stored in AuditLog.audit_data. */

export interface ScriptInventoryEntry {
  token: string;
  status: "deferred" | "protected" | "never" | "noise" | "self" | "candidate";
  reasons: string[];
  bytes?: number;
  encodedBytes?: number;
  durationMs?: number;
  pages: string[];
  /** Hostname the script was requested from. */
  domain?: string;
  /** Script request index on home only (Chrome Network order, 1-based). */
  homeRequestOrder?: number;
  /** performance.resource `startTime` on home (ms from navigation start). */
  homeStartMs?: number;
}

export interface LabVitalsEntry {
  profile: "mobile" | "desktop";
  lcp?: number;
  fcp?: number;
  cls?: number;
  ttfb?: number;
  dcl?: number;
  longTaskCount?: number;
  capturedAt: string;
}

export interface GateImpactEntry {
  path: string;
  profile: "mobile" | "desktop";
  before: LabVitalsEntry;
  after: LabVitalsEntry;
  method: "init-script-sim" | "live-embed";
  deltaLcpMs?: number;
  withinLabNoise?: boolean;
}

export interface AuditRunMeta {
  wallTimeMs: number;
  passesRun: number;
  passesPlanned: number;
  chromiumVersion?: string;
}

export interface FieldVitalsSummary {
  lcp?: number;
  inp?: number;
  cls?: number;
  source: "url" | "origin" | "none";
  fetchedAt?: string;
  lighthouseScore?: number;
  backoffUntil?: string;
  note?: string;
}

export interface ScriptInventoryBlock {
  byToken: ScriptInventoryEntry[];
  totals: {
    scriptRequests: number;
    thirdPartyBytes: number;
    deferredTokenCount: number;
    protectedTokenCount: number;
  };
}

export interface LighthouseUiScores {
  performance?: number;
  accessibility?: number;
  bestPractices?: number;
  seo?: number;
}

export interface LighthouseUiMetrics {
  fcpSec?: number;
  lcpSec?: number;
  tbtMs?: number;
  speedIndexSec?: number;
  cls?: number;
}

export interface LighthouseUiView {
  source: "psi" | "lab";
  categories?: LighthouseUiScores;
  metrics?: LighthouseUiMetrics;
  note?: string;
}

export interface PageSpeedPageView {
  label: string;
  path: string;
  mobile?: LighthouseUiView;
  desktop?: LighthouseUiView;
}

export interface AuditReportSummary {
  completedAt: string;
  pages: Array<{ label: string; path: string }>;
  foldAssertionOk: boolean;
  foldViolations: string[];
  warnings: string[];
  stats: {
    scriptsSeen: number;
    deferred: number;
    protected: number;
    hiddenSelectors: number;
    popups: number;
  };
  funnelSteps: {
    request: number;
    candidates: number;
    emitted: number;
  };
  topScripts: Array<{
    token: string;
    kb: number | null;
    durationMs: number | null;
    status: string;
    reasons: string[];
    pages: string[];
    homeRequestOrder?: number | null;
    homeStartMs?: number | null;
  }>;
  popupSelectors?: string[];
  auditRunMeta?: AuditRunMeta;
  staleScanWarning?: boolean;
  homeLongTaskCount?: number | null;
  psiByUrl?: Array<{
    url: string;
    fieldSource: string;
    lcp?: number | null;
  }>;
  labVitalsByPath?: Record<string, LabVitalsEntry>;
  gateImpact?: GateImpactEntry;
  fieldVitals?: FieldVitalsSummary;
  limits: string[];
  pageSpeedViews?: PageSpeedPageView[];
  /** Set when PSI was not run or must not be shown (e.g. password-protected store). */
  psiSkipNote?: string;
  templateBuckets?: {
    defer: {
      global: string[];
      home: string[];
      collection: string[];
      product: string[];
    };
    hide: {
      global: string[];
      home: string[];
      collection: string[];
      product: string[];
    };
  };
  pageRoles?: Record<string, string>;
}
