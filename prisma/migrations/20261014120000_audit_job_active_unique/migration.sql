-- One queued or running audit job per store (prevents double-enqueue races).
CREATE UNIQUE INDEX IF NOT EXISTS "AuditJob_storeId_active_key"
  ON "AuditJob" ("storeId")
  WHERE status IN ('queued', 'running');

ALTER TABLE "StoreConfig" ADD COLUMN IF NOT EXISTS "activeAuditJobId" TEXT;
