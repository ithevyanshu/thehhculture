import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { notFound, pageMeta, paginate, paginationSchema, parse, param } from '../../lib/http';
import { currentUser, optionalAuth, requireAuth } from '../../middleware/auth';
import {
  albumCardSelect,
  artistCardSelect,
  recordView,
  songCardSelect,
  withFollowFlags,
  withLikeFlags,
} from './selects';
import { recordArtistClick, trendingIds } from './views';

export const artistsRouter = Router();

const listQuery = paginationSchema.extend({
  q: z.string().trim().optional(),
  genre: z.string().optional(),
  region: z.string().optional(),
  featured: z.enum(['true', 'false']).optional(),
  producer: z.enum(['true', 'false']).optional(),
  /** trending = profile clicks in the last 7 days; popular = followers */
  sort: z.enum(['trending', 'popular', 'name', 'new']).default('popular'),
});

artistsRouter.get('/', optionalAuth, async (req, res) => {
  const { page, limit, q: rawQ, genre, region, featured, producer, sort } = parse(listQuery, req.query);
  const q = rawQ?.replace(/^@/, ''); // "@krsna" searches by handle

  const where: Prisma.ArtistWhereInput = {
    ...(q && {
      OR: [
        { name: { contains: q, mode: 'insensitive' } },
        { realName: { contains: q, mode: 'insensitive' } },
        { slug: { contains: q.toLowerCase() } },
        { handle: { contains: q.toLowerCase() } },
      ],
    }),
    ...(producer && { isProducer: producer === 'true' }),
    ...(genre && { genres: { some: { slug: genre } } }),
    ...(region && { region: { slug: region } }),
    ...(featured && { featured: featured === 'true' }),
  };

  if (sort === 'trending') {
    const ranked = await trendingIds(where);
    const pageIds = ranked.slice((page - 1) * limit, page * limit);
    const cards = await prisma.artist.findMany({ where: { id: { in: pageIds.map((r) => r.id) } }, select: artistCardSelect });
    const byId = new Map(cards.map((c) => [c.id, c]));
    const items = pageIds.flatMap((r) => {
      const card = byId.get(r.id);
      return card ? [{ ...card, views: { week: r.week, allTime: r.allTime } }] : [];
    });
    return res.json({ items: await withFollowFlags(req.user?.id, items), meta: pageMeta(page, limit, ranked.length) });
  }

  const orderBy: Prisma.ArtistOrderByWithRelationInput =
    sort === 'name' ? { name: 'asc' } : sort === 'new' ? { createdAt: 'desc' } : { followers: { _count: 'desc' } };

  const [items, total] = await Promise.all([
    prisma.artist.findMany({ where, orderBy: [orderBy, { name: 'asc' }], select: artistCardSelect, ...paginate(page, limit) }),
    prisma.artist.count({ where }),
  ]);

  res.json({ items: await withFollowFlags(req.user?.id, items), meta: pageMeta(page, limit, total) });
});

artistsRouter.get('/:slug', optionalAuth, async (req, res) => {
  const userId = req.user?.id;
  const artist = await prisma.artist.findUnique({
    where: { slug: param(req, 'slug') },
    select: {
      ...artistCardSelect,
      realName: true,
      bio: true,
      imageCredit: true,
      imageSourceUrl: true,
      bannerUrl: true,
      activeSince: true,
      instagramUrl: true,
      youtubeUrl: true,
      spotifyUrl: true,
      spotifyId: true,
      featured: true,
      albums: { select: albumCardSelect, orderBy: { releaseDate: 'desc' } },
    },
  });
  if (!artist) throw notFound('Artist');

  const genreSlugs = artist.genres.map((g) => g.slug);

  const [topSongs, latestSongs, featuredOn, related, likeTotal, produced, appearances] = await Promise.all([
    prisma.song.findMany({
      where: { artistId: artist.id },
      orderBy: [{ likes: { _count: 'desc' } }, { releaseDate: 'desc' }],
      take: 10,
      select: songCardSelect,
    }),
    prisma.song.findMany({
      where: { artistId: artist.id },
      orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
      take: 6,
      select: songCardSelect,
    }),
    prisma.song.findMany({
      where: { features: { some: { artistId: artist.id } } },
      orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
      take: 12,
      select: songCardSelect,
    }),
    prisma.artist.findMany({
      where: {
        id: { not: artist.id },
        OR: [
          { genres: { some: { slug: { in: genreSlugs } } } },
          ...(artist.region ? [{ region: { slug: artist.region.slug } }] : []),
          { features: { some: { song: { artistId: artist.id } } } },
          { songs: { some: { features: { some: { artistId: artist.id } } } } },
        ],
      },
      orderBy: { followers: { _count: 'desc' } },
      take: 8,
      select: artistCardSelect,
    }),
    prisma.songLike.count({ where: { song: { artistId: artist.id } } }),
    prisma.song.findMany({
      where: { producers: { some: { artistId: artist.id } } },
      orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
      take: 24,
      select: songCardSelect,
    }),
    prisma.showAppearance.findMany({
      where: { artistId: artist.id },
      orderBy: [{ season: { year: { sort: 'desc', nulls: 'last' } } }, { season: { number: 'desc' } }],
      select: {
        role: true,
        placement: true,
        season: { select: { number: true, year: true, title: true, show: { select: { slug: true, name: true } } } },
      },
    }),
  ]);

  void recordView(userId, { artistId: artist.id }); // fire-and-forget
  void recordArtistClick(artist.id, userId ?? `ip:${req.ip}`);
  const [[flagged], top, latest, featured, relatedFlagged, producedFlagged] = await Promise.all([
    withFollowFlags(userId, [artist]),
    withLikeFlags(userId, topSongs),
    withLikeFlags(userId, latestSongs),
    withLikeFlags(userId, featuredOn),
    withFollowFlags(userId, related),
    withLikeFlags(userId, produced),
  ]);

  res.json({
    artist: { ...flagged, stats: { followers: artist._count.followers, songs: artist._count.songs, likes: likeTotal } },
    topSongs: top,
    latestSongs: latest,
    featuredOn: featured,
    related: relatedFlagged,
    produced: producedFlagged,
    appearances,
  });
});

const catalogQuery = paginationSchema.extend({
  sort: z.enum(['new', 'old', 'popular', 'title']).default('new'),
  include: z.enum(['own', 'all']).default('all'),
});

/** Full song catalog for an artist (own songs + optionally features). */
artistsRouter.get('/:slug/songs', optionalAuth, async (req, res) => {
  const { page, limit, sort, include } = parse(catalogQuery, req.query);
  const artist = await prisma.artist.findUnique({ where: { slug: param(req, 'slug') }, select: { id: true } });
  if (!artist) throw notFound('Artist');

  const where: Prisma.SongWhereInput =
    include === 'own'
      ? { artistId: artist.id }
      : { OR: [{ artistId: artist.id }, { features: { some: { artistId: artist.id } } }] };

  const orderBy: Prisma.SongOrderByWithRelationInput =
    sort === 'popular'
      ? { likes: { _count: 'desc' } }
      : sort === 'title'
        ? { title: 'asc' }
        : { releaseDate: { sort: sort === 'old' ? 'asc' : 'desc', nulls: 'last' } };

  const [items, total] = await Promise.all([
    prisma.song.findMany({ where, orderBy, select: songCardSelect, ...paginate(page, limit) }),
    prisma.song.count({ where }),
  ]);
  res.json({ items: await withLikeFlags(req.user?.id, items), meta: pageMeta(page, limit, total) });
});

async function artistIdBySlug(slug: string) {
  const artist = await prisma.artist.findUnique({ where: { slug }, select: { id: true } });
  if (!artist) throw notFound('Artist');
  return artist.id;
}

artistsRouter.post('/:slug/follow', requireAuth, async (req, res) => {
  const userId = currentUser(req).id;
  const artistId = await artistIdBySlug(param(req, 'slug'));
  await prisma.follow.upsert({
    where: { userId_artistId: { userId, artistId } },
    create: { userId, artistId },
    update: {},
  });
  const followers = await prisma.follow.count({ where: { artistId } });
  res.json({ isFollowing: true, followers });
});

artistsRouter.delete('/:slug/follow', requireAuth, async (req, res) => {
  const userId = currentUser(req).id;
  const artistId = await artistIdBySlug(param(req, 'slug'));
  await prisma.follow.deleteMany({ where: { userId, artistId } });
  const followers = await prisma.follow.count({ where: { artistId } });
  res.json({ isFollowing: false, followers });
});
