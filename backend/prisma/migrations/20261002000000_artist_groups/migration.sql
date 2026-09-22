-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "groupKind" TEXT,
ADD COLUMN     "isGroup" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ArtistMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT,
    "since" INTEGER,
    "until" INTEGER,

    CONSTRAINT "ArtistMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtistMember_memberId_idx" ON "ArtistMember"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistMember_groupId_memberId_key" ON "ArtistMember"("groupId", "memberId");

-- AddForeignKey
ALTER TABLE "ArtistMember" ADD CONSTRAINT "ArtistMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistMember" ADD CONSTRAINT "ArtistMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

