-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "handle" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Artist_handle_key" ON "Artist"("handle");
