-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "shareable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "shareable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Song" ADD COLUMN     "shareable" BOOLEAN NOT NULL DEFAULT false;

