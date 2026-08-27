-- AlterTable
ALTER TABLE "MediaItem" ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "duplicateOfId" TEXT,
ADD COLUMN     "perceptualHash" TEXT;

-- CreateIndex
CREATE INDEX "MediaItem_contentHash_idx" ON "MediaItem"("contentHash");
