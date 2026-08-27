/*
  Warnings:

  - A unique constraint covering the columns `[backOfId]` on the table `MediaItem` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN     "backOfId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "MediaItem_backOfId_key" ON "MediaItem"("backOfId");

-- AddForeignKey
ALTER TABLE "MediaItem" ADD CONSTRAINT "MediaItem_backOfId_fkey" FOREIGN KEY ("backOfId") REFERENCES "MediaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;
