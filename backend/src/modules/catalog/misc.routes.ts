import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { notFound, parse, param } from '../../lib/http';
import { optionalAuth } from '../../middleware/auth';
import { albumCardSelect, artistCardSelect, songCardSelect, withFollowFlags, withLikeFlags } from './selects';

// ---------- Albums ----------

export const albumsRouter = Router();

albumsRouter.get('/:slug', optionalAuth, async (req, res) => {
  const album = await prisma.album.findUnique({
    where: { slug: param(req, 'slug') },
    select: {
      ...albumCardSelect,
      spotifyId: true,
      artist: { select: { id: true, slug: true, name: true, imageUrl: true } },
      songs: {
        select: { ...songCardSelect, trackNumber: true },
        orderBy: [{ trackNumber: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
      },
    },
  });
  if (!album) throw notFound('Album');

  const [moreAlbums, songs] = await Promise.all([
    prisma.album.findMany({
      where: { artistId: album.artist.id, id: { not: album.id } },
      orderBy: { releaseDate: 'desc' },
      take: 8,
      select: albumCardSelect,
    }),
    withLikeFlags(req.user?.id, album.songs),
  ]);
  res.json({ album: { ...album, songs }, moreAlbums });
});

// ---------- Genres & regions ----------

export const taxonomyRouter = Router();

taxonomyRouter.get('/genres', async (_req, res) => {
  const items = await prisma.genre.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true, description: true, _count: { select: { artists: true, songs: true } } },
  });
  res.json({ items });
});

taxonomyRouter.get('/regions', async (_req, res) => {
  const items = await prisma.region.findMany({
    orderBy: { name: 'asc' },
    select: { id: true, slug: true, name: true, state: true, _count: { select: { artists: true } } },
  });
  res.json({ items });
});

// ---------- Global search ----------

export const searchRouter = Router();

searchRouter.get('/', optionalAuth, async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
  const contains = { contains: q, mode: 'insensitive' as const };

  const ARTIST_SLOTS = 8;

  const [named, songs, albums] = await Promise.all([
    prisma.artist.findMany({
      where: { OR: [{ name: contains }, { realName: contains }, { handle: contains }] },
      orderBy: { followers: { _count: 'desc' } },
      take: ARTIST_SLOTS,
      select: artistCardSelect,
    }),
    prisma.song.findMany({
      where: { OR: [{ title: contains }, { artist: { name: contains } }] },
      orderBy: { likes: { _count: 'desc' } },
      take: 10,
      select: songCardSelect,
    }),
    prisma.album.findMany({
      where: { OR: [{ title: contains }, { artist: { name: contains } }] },
      orderBy: { releaseDate: 'desc' },
      take: 8,
      select: albumCardSelect,
    }),
  ]);

  // Searching a song title should still tell you who made it. Whatever slots are left
  // after the name matches go to the artists behind the matching songs and albums,
  // in the order those results came back.
  const seen = new Set(named.map((a) => a.id));
  const behind: string[] = [];
  for (const row of [...songs, ...albums]) {
    if (seen.has(row.artist.id)) continue;
    seen.add(row.artist.id);
    behind.push(row.artist.id);
  }
  const wanted = behind.slice(0, Math.max(0, ARTIST_SLOTS - named.length));
  const extra = wanted.length ? await prisma.artist.findMany({ where: { id: { in: wanted } }, select: artistCardSelect }) : [];
  const byId = new Map(extra.map((a) => [a.id, a]));
  const artists = [...named, ...wanted.map((id) => byId.get(id)).filter((a) => !!a)];

  const [flaggedArtists, flaggedSongs] = await Promise.all([
    withFollowFlags(req.user?.id, artists),
    withLikeFlags(req.user?.id, songs),
  ]);
  res.json({ artists: flaggedArtists, songs: flaggedSongs, albums });
});
