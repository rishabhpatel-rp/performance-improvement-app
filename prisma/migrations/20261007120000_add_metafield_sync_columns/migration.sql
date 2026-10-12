-- AlterTable
ALTER TABLE "performance_scripts" ADD COLUMN     "inputs_hash" TEXT,
ADD COLUMN     "metafield_hash" TEXT,
ADD COLUMN     "metafield_synced_at" TIMESTAMP(3);
