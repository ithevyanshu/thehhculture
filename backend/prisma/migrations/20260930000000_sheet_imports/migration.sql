-- Spreadsheet uploads: batches can create artists and change existing rows, so undo needs the previous values.
-- AlterEnum
ALTER TYPE "ImportSource" ADD VALUE 'SHEET';

-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "artistIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "label" TEXT,
ADD COLUMN     "updates" JSONB;

