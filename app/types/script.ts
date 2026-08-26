export type TargetPage =
  | 'all'
  | 'home'
  | 'product'
  | 'collection'
  | 'cart'
  | 'checkout'
  | 'custom';

export type Position = 'head' | 'body_start' | 'body_end';

export interface ScriptMetaobject {
  id: string;
  name: string;
  code: string;
  enabled: boolean;
  targetPages: TargetPage[];
  customPageHandles: string[];
  position: Position;
  priority: number;
  async: boolean;
  defer: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScriptInput {
  name: string;
  code: string;
  enabled?: boolean;
  targetPages?: TargetPage[];
  customPageHandles?: string[];
  position?: Position;
  priority?: number;
  async?: boolean;
  defer?: boolean;
}

export interface GlobalConfig {
  autoInject: boolean;
  debugMode: boolean;
}

export interface GlobalConfigInput {
  autoInject?: boolean;
  debugMode?: boolean;
}

export interface ScriptsConnection {
  edges: Array<{ node: ScriptMetaobject }>;
  pageInfo: {
    hasNextPage: boolean;
    hasPreviousPage: boolean;
    startCursor: string;
    endCursor: string;
  };
}