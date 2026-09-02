/*
  Warnings:

  - You are about to drop the column `auditComplete` on the `StoreConfig` table. All the data in the column will be lost.
  - You are about to drop the column `auditDeferArray` on the `StoreConfig` table. All the data in the column will be lost.
  - You are about to drop the column `auditHideSelectors` on the `StoreConfig` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StoreConfig" DROP COLUMN "auditComplete",
DROP COLUMN "auditDeferArray",
DROP COLUMN "auditHideSelectors";
