-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('SCHEDULED', 'POSTPONED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "allDay" BOOLEAN NOT NULL DEFAULT false,
    "venue" TEXT,
    "address" TEXT,
    "regionId" TEXT,
    "posterUrl" TEXT,
    "ticketUrl" TEXT,
    "priceFrom" INTEGER,
    "status" "EventStatus" NOT NULL DEFAULT 'SCHEDULED',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventArtist" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "EventArtist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE INDEX "Event_startsAt_idx" ON "Event"("startsAt");

-- CreateIndex
CREATE INDEX "Event_regionId_idx" ON "Event"("regionId");

-- CreateIndex
CREATE INDEX "EventArtist_artistId_idx" ON "EventArtist"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "EventArtist_eventId_artistId_key" ON "EventArtist"("eventId", "artistId");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventArtist" ADD CONSTRAINT "EventArtist_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventArtist" ADD CONSTRAINT "EventArtist_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

