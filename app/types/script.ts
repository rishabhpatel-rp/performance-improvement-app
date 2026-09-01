export interface AppConfig {
  appEnabled: boolean;
  script1Enabled: boolean;
  script2Enabled: boolean;
  script3Enabled: boolean;
  scriptTitles: string[]; // one entry per script, in order [title1, title2, title3]
  debugMode: boolean;
  auditDeferArray: string[]; // audited defer (P) array fed into script_2
  auditHideSelectors: string[]; // audited off-screen CSS selectors fed into script_3
  auditComplete: boolean; // true once the one-time audit has posted results back
  appEndpoint: string; // public /audit-submit URL (auto-populated, read by storefront)
}

export interface AppConfigInput {
  appEnabled?: boolean;
  script1Enabled?: boolean;
  script2Enabled?: boolean;
  script3Enabled?: boolean;
  scriptTitles?: string[];
  debugMode?: boolean;
  auditDeferArray?: string[];
  auditHideSelectors?: string[];
  auditComplete?: boolean;
  appEndpoint?: string;
}

export interface PredefinedScript {
  id: "script_1" | "script_2" | "script_3";
  name: string;
  type: "script" | "style"; // needed to pick the right wrapper tag
  code: string;
  defaultEnabled: boolean;
}

export interface AuditSubmitPayload {
  deferArray: string[];
  hideSelectors: string[];
}
