/**
 * Export or wipe the song/album catalog.
 *
 *   npx tsx scripts/catalog-backup.ts                      # write backups/catalog-<date>.json
 *   npx tsx scripts/catalog-backup.ts --wipe               # export first, then delete every song and album
 *
 * The export keeps what iTunes can't give back: producer and feature credits, genre
 * tags, Spotify/YouTube ids, lyrics links and who liked what. Deleting songs also
 * removes their likes, playlist entries and recent-view history, so the export is the
 * only way back. Site settings that point at deleted songs (chart pins, ticker items,
 * cover-story slides, curated sections) are cleaned up so the front page keeps working.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { prisma } from '../src/lib/prisma';
import { getSiteConfig, saveSetting } from '../src/modules/site/config';

const WIPE = process.argv.includes('--wipe');

(async () => {
  const songs = await prisma.song.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      artist: { select: { slug: true, name: true } },
      album: { select: { slug: true, title: true } },
      genres: { select: { slug: true } },
      features: { select: { artist: { select: { slug: true, handle: true } } } },
      producers: { select: { artist: { select: { slug: true, handle: true } } } },
      likes: { select: { userId: true, createdAt: true } },
      playlistEntries: { select: { playlistId: true, position: true } },
    },
  });
  const albums = await prisma.album.findMany({ orderBy: { createdAt: 'asc' }, include: { artist: { select: { slug: true } } } });

  const dir = path.join(__dirname, '../backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `catalog-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify({ exportedAt: new Date().toISOString(), songs, albums }, null, 2));
  console.log(`Exported ${songs.length} songs and ${albums.length} albums to ${file}`);
  console.log(
    `Includes ${songs.reduce((n, s) => n + s.producers.length, 0)} producer credits, ${songs.reduce((n, s) => n + s.features.length, 0)} features, ` +
      `${songs.reduce((n, s) => n + s.likes.length, 0)} likes, ${songs.filter((s) => s.genres.length).length} songs with genres.`,
  );

  if (!WIPE) return prisma.$disconnect();

  // Front-page settings that name individual songs would dangle after the wipe.
  const config = await getSiteConfig();
  const systemUser = await prisma.user.findFirstOrThrow({ where: { role: 'ADMIN' }, select: { id: true } });
  if (config.chart.pinnedSongIds.length || config.chart.excludedSongIds.length) {
    await saveSetting('chart', { ...config.chart, pinnedSongIds: [], excludedSongIds: [] }, systemUser.id);
    console.log('Cleared chart pins and exclusions.');
  }
  const tickerItems = config.ticker.items.filter((i) => i.type !== 'song');
  if (tickerItems.length !== config.ticker.items.length) {
    await saveSetting('ticker', { ...config.ticker, items: tickerItems }, systemUser.id);
    console.log('Removed songs pinned in the ticker.');
  }
  const slides = config.coverStory.slides.map((s) => (s.type === 'artist' ? { ...s, songId: null } : s));
  if (JSON.stringify(slides) !== JSON.stringify(config.coverStory.slides)) {
    await saveSetting('coverStory', { ...config.coverStory, slides }, systemUser.id);
    console.log('Cleared songs promoted on cover-story slides (the artist stays).');
  }
  const sections = config.sections.items.map((i) => (i.custom?.kind === 'songs' ? { ...i, custom: { ...i.custom, ids: [] } } : i));
  if (JSON.stringify(sections) !== JSON.stringify(config.sections.items)) {
    await saveSetting('sections', { items: sections }, systemUser.id);
    console.log('Emptied hand-picked song sections on the front page.');
  }

  const [deletedSongs, deletedAlbums] = await prisma.$transaction([prisma.song.deleteMany({}), prisma.album.deleteMany({})]);
  // Import batches now point at rows that no longer exist; their undo would do nothing.
  await prisma.importBatch.deleteMany({});
  console.log(`Deleted ${deletedSongs.count} songs and ${deletedAlbums.count} albums. Restore data lives in ${path.basename(file)}.`);
  await prisma.$disconnect();
})();
