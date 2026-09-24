-- AlterTable
ALTER TABLE "performance_scripts" ADD COLUMN     "script_built_at" TIMESTAMP(3),
ADD COLUMN     "script_hash" TEXT;
