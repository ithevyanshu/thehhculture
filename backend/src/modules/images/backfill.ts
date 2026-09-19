import { prisma } from '../../lib/prisma';
import { handleAfterInstagramChange } from '../../lib/handles';
import { findArtistImage, findArtistPage, instagramHandle, instagramUrl } from './wikipedia';

export interface BackfillResult {
  artist: string;
  status: 'updated' | 'not-found' | 'error';
  pageTitle?: string;
  /** For Instagram backfills: the handle that was saved. */
  handle?: string;
  error?: string;
}

/** Fill artist photos from Wikipedia. By default only artists without an image are touched. */
export async function backfillArtistImages({ overwrite = false } = {}): Promise<BackfillResult[]> {
  const artists = await prisma.artist.findMany({
    where: overwrite ? {} : { imageUrl: null },
    select: { id: true, name: true, realName: true },
    orderBy: { name: 'asc' },
  });

  const results: BackfillResult[] = [];
  for (const artist of artists) {
    try {
      const match = await findArtistImage(artist);
      if (!match) {
        results.push({ artist: artist.name, status: 'not-found' });
        continue;
      }
      await prisma.artist.update({
        where: { id: artist.id },
        data: { imageUrl: match.imageUrl, imageCredit: match.credit, imageSourceUrl: match.sourceUrl },
      });
      results.push({ artist: artist.name, status: 'updated', pageTitle: match.pageTitle });
    } catch (err) {
      results.push({ artist: artist.name, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}

/**
 * Fill Instagram links from Wikidata (property P2003). Only artists without a link are
 * touched unless `overwrite`. Artists missing from Wikidata are reported as not-found.
 */
export async function backfillInstagram({ overwrite = false } = {}): Promise<BackfillResult[]> {
  const artists = await prisma.artist.findMany({
    where: overwrite ? {} : { instagramUrl: null },
    select: { id: true, name: true, realName: true, handle: true },
    orderBy: { name: 'asc' },
  });

  const results: BackfillResult[] = [];
  for (const artist of artists) {
    try {
      const page = await findArtistPage(artist);
      const handle = page ? await instagramHandle(page.wikidataId) : null;
      if (!page || !handle) {
        results.push({ artist: artist.name, status: 'not-found', pageTitle: page?.title });
        continue;
      }
      const url = instagramUrl(handle);
      const nextHandle = await handleAfterInstagramChange(artist, url);
      await prisma.artist.update({ where: { id: artist.id }, data: { instagramUrl: url, ...(nextHandle && { handle: nextHandle }) } });
      results.push({ artist: artist.name, status: 'updated', pageTitle: page.title, handle });
    } catch (err) {
      results.push({ artist: artist.name, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return results;
}