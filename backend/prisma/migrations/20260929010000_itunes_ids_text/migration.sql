-- iTunes ids exceed a 32-bit integer (e.g. 6804703168), so store them as text.
ALTER TABLE "Artist" ALTER COLUMN "itunesId" SET DATA TYPE TEXT;
ALTER TABLE "Song" ALTER COLUMN "itunesTrackId" SET DATA TYPE TEXT;
