-- Catalog imports from iTunes, recorded per run so they can be undone in one click.
-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('ITUNES');

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "itunesId" INTEGER;

-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "itunesTrackId" INTEGER;

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL DEFAULT 'ITUNES',
    "artistId" TEXT,
    "artistName" TEXT NOT NULL,
    "createdById" TEXT,
    "albumIds" TEXT[],
    "songIds" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImportBatch_createdAt_idx" ON "ImportBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_itunesId_key" ON "Artist"("itunesId");

-- CreateIndex
CREATE UNIQUE INDEX "Song_itunesTrackId_key" ON "Song"("itunesTrackId");

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_undoneById_fkey" FOREIGN KEY ("undoneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

