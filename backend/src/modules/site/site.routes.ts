import { Router } from 'express';
import { prisma } from '../../lib/prisma';
import { getSiteConfig } from './config';

/** Public site chrome: announcement banner + ticker. Cheap and cacheable by clients. */
export const siteRouter = Router();

const tickerSongSelect = { id: true, slug: true, title: true, artist: { select: { name: true, slug: true } } } as const;

siteRouter.get('/', async (_req, res) => {
  const config = await getSiteConfig();

  const a = config.announcement;
  const announcement =
    a.enabled && a.text && (!a.expiresAt || Date.parse(a.expiresAt) > Date.now())
      ? { text: a.text, linkUrl: a.linkUrl, linkLabel: a.linkLabel, tone: a.tone }
      : null;

  let ticker = null;
  if (config.ticker.mode === 'auto') {
    const songs = await prisma.song.findMany({
      where: { releaseDate: { not: null } },
      orderBy: { releaseDate: 'desc' },
      take: 12,
      select: tickerSongSelect,
    });
    ticker = { label: config.ticker.label, items: songs.map((song) => ({ type: 'song' as const, song })) };
  } else if (config.ticker.mode === 'manual') {
    const songIds = config.ticker.items.flatMap((i) => (i.type === 'song' ? [i.songId] : []));
    const songs = songIds.length ? await prisma.song.findMany({ where: { id: { in: songIds } }, select: tickerSongSelect }) : [];
    const byId = new Map(songs.map((s) => [s.id, s]));
    type Item =
      | { type: 'text'; text: string; linkUrl: string | null }
      | { type: 'song'; song: NonNullable<ReturnType<typeof byId.get>> };
    const items = config.ticker.items.flatMap((i): Item[] => {
      if (i.type === 'text') return [{ type: 'text', text: i.text, linkUrl: i.linkUrl }];
      const song = byId.get(i.songId);
      return song ? [{ type: 'song' as const, song }] : []; // skip deleted songs
    });
    ticker = items.length ? { label: config.ticker.label, items } : null;
  }

  res.set('Cache-Control', 'public, max-age=30');
  res.json({ announcement, ticker });
});
