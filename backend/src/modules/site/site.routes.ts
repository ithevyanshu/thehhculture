import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { getSiteConfig, type SiteConfig } from './config';

/** Public site chrome: announcement banner + ticker. Cheap and cacheable by clients. */
export const siteRouter = Router();

const tickerSongSelect = { id: true, slug: true, title: true, artist: { select: { name: true, slug: true } } } as const;
type TickerSong = Prisma.SongGetPayload<{ select: typeof tickerSongSelect }>;

type TickerItem =
  | { type: 'song'; song: TickerSong }
  | { type: 'artist'; artist: { name: string; slug: string } }
  | { type: 'show'; show: { name: string; slug: string } }
  | { type: 'text'; text: string; linkUrl: string | null };

/** Editor items in order; deleted songs/artists/shows drop out. */
async function pickedItems(items: SiteConfig['ticker']['items']): Promise<TickerItem[]> {
  const ids = (type: string) => items.flatMap((i) => (i.type === type ? [(i as Record<string, string>)[`${type}Id`]] : []));
  const [songs, artists, shows] = await Promise.all([
    prisma.song.findMany({ where: { id: { in: ids('song') } }, select: tickerSongSelect }),
    prisma.artist.findMany({ where: { id: { in: ids('artist') } }, select: { id: true, name: true, slug: true } }),
    prisma.show.findMany({ where: { id: { in: ids('show') } }, select: { id: true, name: true, slug: true } }),
  ]);
  const song = new Map(songs.map((s) => [s.id, s]));
  const artist = new Map(artists.map((a) => [a.id, a]));
  const show = new Map(shows.map((s) => [s.id, s]));
  return items.flatMap((i): TickerItem[] => {
    if (i.type === 'text') return [{ type: 'text', text: i.text, linkUrl: i.linkUrl }];
    if (i.type === 'song') return song.has(i.songId) ? [{ type: 'song', song: song.get(i.songId)! }] : [];
    if (i.type === 'artist') return artist.has(i.artistId) ? [{ type: 'artist', artist: artist.get(i.artistId)! }] : [];
    return show.has(i.showId) ? [{ type: 'show', show: show.get(i.showId)! }] : [];
  });
}

/** Latest releases, filtered by the admin's auto settings. */
async function latestSongs(auto: SiteConfig['ticker']['auto'], skip: string[]) {
  const where: Prisma.SongWhereInput = { releaseDate: { not: null }, id: { notIn: skip } };
  if (auto.withinDays) where.releaseDate = { gte: new Date(Date.now() - auto.withinDays * 86_400_000) };
  if (auto.genreSlugs.length) where.genres = { some: { slug: { in: auto.genreSlugs } } };
  if (auto.regionSlugs.length) where.artist = { region: { slug: { in: auto.regionSlugs } } };
  return prisma.song.findMany({ where, orderBy: { releaseDate: 'desc' }, take: auto.count, select: tickerSongSelect });
}

siteRouter.get('/', async (_req, res) => {
  const config = await getSiteConfig();

  const a = config.announcement;
  const announcement =
    a.enabled && a.text && (!a.expiresAt || Date.parse(a.expiresAt) > Date.now())
      ? { text: a.text, linkUrl: a.linkUrl, linkLabel: a.linkLabel, tone: a.tone }
      : null;

  const t = config.ticker;
  let ticker = null;
  if (t.mode !== 'hidden') {
    const picked = await pickedItems(t.items);
    const pickedSongIds = picked.flatMap((i) => (i.type === 'song' ? [i.song.id] : []));
    const latest = t.mode === 'auto' ? await latestSongs(t.auto, pickedSongIds) : [];
    const items = [...picked, ...latest.map((song) => ({ type: 'song' as const, song }))];
    ticker = items.length ? { label: t.label, tone: t.tone, speed: t.speed, items } : null;
  }

  res.set('Cache-Control', 'public, max-age=30');
  res.json({ announcement, ticker });
});
