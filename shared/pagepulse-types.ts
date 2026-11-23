/** Types shared by the merchant app and the admin panel. Field names here mirror
 *  root `prisma/schema.prisma`; `scripts/check-schema-drift.mjs` keeps them honest. */

export type TemplateScope = "global" | "home" | "collection" | "product";

export type AuditPhase = "discovering" | "auditing" | "building";

export interface AuditStatusShape {
  running: boolean;
  complete: boolean;
  failed: boolean;
  error: string | null;
  pageIndex: number;
  totalPages: number;
  progress: number;
  phase: AuditPhase | "queued" | null;
  errorMessage?: string | null;
}

export interface StoreConfigShape {
  appEnabled: boolean;
  adminManaged?: boolean;
  auditComplete?: boolean;
  auditRunning?: boolean;
  auditFailed?: boolean;
  auditPhase?: string | null;
  activeAuditJobId?: string | null;
  lastAuditAt?: Date | string | null;
  hasStorefrontPassword?: boolean;
  firstUserDelayMs?: number | null;
  everyTimeDelayMs?: number | null;
}
