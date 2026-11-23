-- Align AuditJob column defaults with prisma/schema.prisma (CQ-17).
-- CREATE TABLE used DEFAULT '' / CURRENT_TIMESTAMP; schema has no @default on these fields.
ALTER TABLE "AuditJob" ALTER COLUMN "shopDomain" DROP DEFAULT;
ALTER TABLE "AuditJob" ALTER COLUMN "updatedAt" DROP DEFAULT;
