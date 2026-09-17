-- Reconcile DB with prisma/schema.prisma and add audit lifecycle fields.
--
-- 1) Re-add the StoreConfig audit columns that were dropped by
--    `20260902073700_drop_audit_columns`.
-- 2) Add the new audit lifecycle/status columns.
-- 3) Create the PerformanceScript table (declared in schema but never migrated).
-- 4) Create the AuditLog table (declared in schema but never migrated).

-- 1) Re-add dropped StoreConfig audit columns
ALTER TABLE "StoreConfig" ADD COLUMN "auditComplete" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreConfig" ADD COLUMN "auditDeferArray" JSONB NOT NULL DEFAULT '[]';
ALTER TABLE "StoreConfig" ADD COLUMN "auditHideSelectors" JSONB NOT NULL DEFAULT '[]';

-- 2) Audit lifecycle/status columns
ALTER TABLE "StoreConfig" ADD COLUMN "auditRunning" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreConfig" ADD COLUMN "auditFailed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "StoreConfig" ADD COLUMN "auditError" TEXT;
ALTER TABLE "StoreConfig" ADD COLUMN "lastAuditAt" TIMESTAMP(3);

-- 3) PerformanceScript table (1:1 with Store, mapped to "performance_scripts")
CREATE TABLE "performance_scripts" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "audit_script" TEXT,
    "defer_script" TEXT,
    "hidden_css" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "performance_scripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "performance_scripts_storeId_key" ON "performance_scripts"("storeId");

-- CreateIndex
CREATE INDEX "performance_scripts_storeId_idx" ON "performance_scripts"("storeId");

-- AddForeignKey
ALTER TABLE "performance_scripts" ADD CONSTRAINT "performance_scripts_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) AuditLog table
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "domain" TEXT NOT NULL,
    "audit_type" TEXT NOT NULL DEFAULT 'general',
    "audit_data" JSONB,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditLog_domain_idx" ON "AuditLog"("domain");

-- CreateIndex
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog"("timestamp");
