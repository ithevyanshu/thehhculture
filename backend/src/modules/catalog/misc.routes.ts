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

  const [artists, songs, albums] = await Promise.all([
    prisma.artist.findMany({
      where: { OR: [{ name: contains }, { realName: contains }] },
      orderBy: { followers: { _count: 'desc' } },
      take: 8,
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

  const [flaggedArtists, flaggedSongs] = await Promise.all([
    withFollowFlags(req.user?.id, artists),
    withLikeFlags(req.user?.id, songs),
  ]);
  res.json({ artists: flaggedArtists, songs: flaggedSongs, albums });
});
