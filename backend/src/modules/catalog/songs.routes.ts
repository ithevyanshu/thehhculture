import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { notFound, pageMeta, paginate, paginationSchema, parse, param } from '../../lib/http';
import { currentUser, optionalAuth, requireAuth } from '../../middleware/auth';
import { recordView, songCardSelect, withLikeFlags } from './selects';

export const songsRouter = Router();

const listQuery = paginationSchema.extend({
  q: z.string().trim().optional(),
  genre: z.string().optional(),
  artist: z.string().optional(),
  region: z.string().optional(),
  year: z.coerce.number().int().min(1980).max(2100).optional(),
  sort: z.enum(['new', 'old', 'popular', 'title']).default('new'),
});

songsRouter.get('/', optionalAuth, async (req, res) => {
  const { page, limit, q, genre, artist, region, year, sort } = parse(listQuery, req.query);

  const and: Prisma.SongWhereInput[] = [];
  if (q) {
    and.push({
      OR: [
        { title: { contains: q, mode: 'insensitive' } },
        { artist: { name: { contains: q, mode: 'insensitive' } } },
        { album: { title: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }
  if (genre) and.push({ genres: { some: { slug: genre } } });
  if (artist) and.push({ OR: [{ artist: { slug: artist } }, { features: { some: { artist: { slug: artist } } } }] });
  if (region) and.push({ artist: { region: { slug: region } } });
  if (year) {
    and.push({ releaseDate: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } });
  }
  const where: Prisma.SongWhereInput = and.length ? { AND: and } : {};

  const orderBy: Prisma.SongOrderByWithRelationInput[] =
    sort === 'popular'
      ? [{ likes: { _count: 'desc' } }, { releaseDate: { sort: 'desc', nulls: 'last' } }]
      : sort === 'title'
        ? [{ title: 'asc' }]
        : [{ releaseDate: { sort: sort === 'old' ? 'asc' : 'desc', nulls: 'last' } }, { title: 'asc' }];

  const [items, total] = await Promise.all([
    prisma.song.findMany({ where, orderBy, select: songCardSelect, ...paginate(page, limit) }),
    prisma.song.count({ where }),
  ]);
  res.json({ items: await withLikeFlags(req.user?.id, items), meta: pageMeta(page, limit, total) });
});

songsRouter.get('/:slug', optionalAuth, async (req, res) => {
  const userId = req.user?.id;
  const song = await prisma.song.findUnique({
    where: { slug: param(req, 'slug') },
    select: { ...songCardSelect, trackNumber: true, lyricsUrl: true, createdAt: true },
  });
  if (!song) throw notFound('Song');

  const [moreFromArtist, similar] = await Promise.all([
    prisma.song.findMany({
      where: { artistId: song.artist.id, id: { not: song.id } },
      orderBy: [{ likes: { _count: 'desc' } }, { releaseDate: 'desc' }],
      take: 6,
      select: songCardSelect,
    }),
    prisma.song.findMany({
      where: {
        id: { not: song.id },
        artistId: { not: song.artist.id },
        genres: { some: { slug: { in: song.genres.map((g) => g.slug) } } },
      },
      orderBy: { likes: { _count: 'desc' } },
      take: 6,
      select: songCardSelect,
    }),
  ]);

  void recordView(userId, { songId: song.id }); // fire-and-forget
  // One likes lookup for the song and both lists.
  const flagged = await withLikeFlags(userId, [song, ...moreFromArtist, ...similar]);
  const likedById = new Map(flagged.map((s) => [s.id, s.isLiked]));
  const flag = <T extends { id: string }>(list: T[]) => list.map((s) => ({ ...s, isLiked: likedById.get(s.id) ?? false }));

  res.json({
    song: flag([song])[0],
    moreFromArtist: flag(moreFromArtist),
    similar: flag(similar),
  });
});

async function songIdBySlug(slug: string) {
  const song = await prisma.song.findUnique({ where: { slug }, select: { id: true } });
  if (!song) throw notFound('Song');
  return song.id;
}

songsRouter.post('/:slug/like', requireAuth, async (req, res) => {
  const userId = currentUser(req).id;
  const songId = await songIdBySlug(param(req, 'slug'));
  await prisma.songLike.upsert({
    where: { userId_songId: { userId, songId } },
    create: { userId, songId },
    update: {},
  });
  res.json({ isLiked: true, likes: await prisma.songLike.count({ where: { songId } }) });
});

songsRouter.delete('/:slug/like', requireAuth, async (req, res) => {
  const userId = currentUser(req).id;
  const songId = await songIdBySlug(param(req, 'slug'));
  await prisma.songLike.deleteMany({ where: { userId, songId } });
  res.json({ isLiked: false, likes: await prisma.songLike.count({ where: { songId } }) });
});
