-- CreateEnum
CREATE TYPE "ShowRole" AS ENUM ('WINNER', 'RUNNER_UP', 'FINALIST', 'CONTESTANT', 'JUDGE', 'GUEST_JUDGE', 'HOST');

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "isProducer" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SongProducer" (
    "songId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,

    CONSTRAINT "SongProducer_pkey" PRIMARY KEY ("songId","artistId")
);

-- CreateTable
CREATE TABLE "Show" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "network" TEXT,
    "description" TEXT,
    "logoUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Show_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowSeason" (
    "id" TEXT NOT NULL,
    "showId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "year" INTEGER,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShowAppearance" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "role" "ShowRole" NOT NULL,

    CONSTRAINT "ShowAppearance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SongProducer_artistId_idx" ON "SongProducer"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "Show_slug_key" ON "Show"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ShowSeason_showId_number_key" ON "ShowSeason"("showId", "number");

-- CreateIndex
CREATE INDEX "ShowAppearance_artistId_idx" ON "ShowAppearance"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "ShowAppearance_seasonId_artistId_role_key" ON "ShowAppearance"("seasonId", "artistId", "role");

-- AddForeignKey
ALTER TABLE "SongProducer" ADD CONSTRAINT "SongProducer_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SongProducer" ADD CONSTRAINT "SongProducer_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowSeason" ADD CONSTRAINT "ShowSeason_showId_fkey" FOREIGN KEY ("showId") REFERENCES "Show"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowAppearance" ADD CONSTRAINT "ShowAppearance_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "ShowSeason"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShowAppearance" ADD CONSTRAINT "ShowAppearance_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
