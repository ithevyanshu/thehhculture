-- CreateEnum
CREATE TYPE "SuggestionType" AS ENUM ('MISSING_ARTIST', 'MISSING_SONG', 'CORRECTION', 'FEATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('NEW', 'PLANNED', 'DONE', 'DISMISSED');

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "viewCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Suggestion" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "SuggestionType" NOT NULL,
    "message" TEXT NOT NULL,
    "contextUrl" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'NEW',
    "adminNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Suggestion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistDailyView" (
    "artistId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ArtistDailyView_pkey" PRIMARY KEY ("artistId","day")
);

-- CreateIndex
CREATE INDEX "Suggestion_status_createdAt_idx" ON "Suggestion"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Suggestion_userId_idx" ON "Suggestion"("userId");

-- CreateIndex
CREATE INDEX "ArtistDailyView_day_idx" ON "ArtistDailyView"("day");

-- AddForeignKey
ALTER TABLE "Suggestion" ADD CONSTRAINT "Suggestion_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistDailyView" ADD CONSTRAINT "ArtistDailyView_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
