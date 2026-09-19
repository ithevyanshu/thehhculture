-- Artist Studio: one managing account per artist, change queue/audit log, artist posts.
-- CreateEnum
CREATE TYPE "ArtistChangeAction" AS ENUM ('PROFILE_UPDATE', 'ALBUM_CREATE', 'ALBUM_UPDATE', 'ALBUM_DELETE', 'SONG_CREATE', 'SONG_UPDATE', 'SONG_DELETE', 'POST_CREATE');

-- CreateEnum
CREATE TYPE "ArtistChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

-- CreateTable
CREATE TABLE "ArtistChange" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "authorId" TEXT,
    "action" "ArtistChangeAction" NOT NULL,
    "targetId" TEXT,
    "summary" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "ArtistChangeStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistPost" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "linkUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtistChange_status_createdAt_idx" ON "ArtistChange"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ArtistChange_artistId_createdAt_idx" ON "ArtistChange"("artistId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtistPost_artistId_createdAt_idx" ON "ArtistPost"("artistId", "createdAt");

-- CreateIndex
CREATE INDEX "ArtistPost_createdAt_idx" ON "ArtistPost"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_managedById_key" ON "Artist"("managedById");

-- AddForeignKey
ALTER TABLE "ArtistChange" ADD CONSTRAINT "ArtistChange_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistChange" ADD CONSTRAINT "ArtistChange_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistChange" ADD CONSTRAINT "ArtistChange_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistPost" ADD CONSTRAINT "ArtistPost_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

