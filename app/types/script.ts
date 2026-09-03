export interface AppConfig {
  appEnabled: boolean;
  script1Enabled: boolean;
  script2Enabled: boolean;
  script3Enabled: boolean;
  scriptTitles: string[]; // one entry per script, in order [title1, title2, title3]
  debugMode: boolean;
  auditDeferArray: string[];
  auditHideSelectors: string[];
  auditComplete: boolean;
  appEndpoint: string;
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
