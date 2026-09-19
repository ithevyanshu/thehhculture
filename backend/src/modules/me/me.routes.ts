import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { pageMeta, paginate, paginationSchema, parse } from '../../lib/http';
import { currentUser, requireAuth } from '../../middleware/auth';
import { getPublicUser, publicUserSelect } from '../auth/auth.service';
import { artistCardSelect, songCardSelect, withFollowFlags, withLikeFlags } from '../catalog/selects';

export const meRouter = Router();
meRouter.use(requireAuth);

const optionalUrl = z.union([z.string().trim().url().max(500), z.literal('')]).optional();

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  bio: z.string().trim().max(300).optional(),
  avatarUrl: optionalUrl,
});

meRouter.patch('/profile', async (req, res) => {
  const input = parse(profileSchema, req.body);
  const user = await prisma.user.update({
    where: { id: currentUser(req).id },
    data: { ...input, avatarUrl: input.avatarUrl === '' ? null : input.avatarUrl },
    select: publicUserSelect,
  });
  res.json({ user });
});

const preferencesSchema = z.object({
  genreSlugs: z.array(z.string()).max(20).default([]),
  regionSlugs: z.array(z.string()).max(20).default([]),
  followArtistSlugs: z.array(z.string()).max(50).optional(),
});

/** Saves favourite genres/regions (replacing previous choices) and completes onboarding. */
meRouter.put('/preferences', async (req, res) => {
  const userId = currentUser(req).id;
  const { genreSlugs, regionSlugs, followArtistSlugs } = parse(preferencesSchema, req.body);

  await prisma.user.update({
    where: { id: userId },
    data: {
      onboarded: true,
      favoriteGenres: { set: genreSlugs.map((slug) => ({ slug })) },
      favoriteRegions: { set: regionSlugs.map((slug) => ({ slug })) },
    },
  });

  if (followArtistSlugs?.length) {
    const artists = await prisma.artist.findMany({ where: { slug: { in: followArtistSlugs } }, select: { id: true } });
    await prisma.follow.createMany({
      data: artists.map((a) => ({ userId, artistId: a.id })),
      skipDuplicates: true,
    });
  }

  res.json({ user: await getPublicUser(userId) });
});

meRouter.get('/following', async (req, res) => {
  const userId = currentUser(req).id;
  const { page, limit } = parse(paginationSchema, req.query);
  const [rows, total] = await Promise.all([
    prisma.follow.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { artist: { select: artistCardSelect } },
      ...paginate(page, limit),
    }),
    prisma.follow.count({ where: { userId } }),
  ]);
  const items = await withFollowFlags(userId, rows.map((r) => r.artist));
  res.json({ items, meta: pageMeta(page, limit, total) });
});

meRouter.get('/likes', async (req, res) => {
  const userId = currentUser(req).id;
  const { page, limit } = parse(paginationSchema, req.query);
  const [rows, total] = await Promise.all([
    prisma.songLike.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      select: { song: { select: songCardSelect } },
      ...paginate(page, limit),
    }),
    prisma.songLike.count({ where: { userId } }),
  ]);
  res.json({ items: rows.map((r) => ({ ...r.song, isLiked: true })), meta: pageMeta(page, limit, total) });
});

meRouter.get('/recent', async (req, res) => {
  const userId = currentUser(req).id;
  const items = await recentlyViewed(userId, 20);
  res.json({ items });
});

meRouter.delete('/recent', async (req, res) => {
  await prisma.recentView.deleteMany({ where: { userId: currentUser(req).id } });
  res.status(204).end();
});

export type RecentItem =
  | { kind: 'artist'; viewedAt: Date; artist: Awaited<ReturnType<typeof withFollowFlags>>[number] }
  | { kind: 'song'; viewedAt: Date; song: Awaited<ReturnType<typeof withLikeFlags>>[number] };

export async function recentlyViewed(userId: string, take: number) {
  const rows = await prisma.recentView.findMany({
    where: { userId },
    orderBy: { viewedAt: 'desc' },
    take,
    select: {
      viewedAt: true,
      artist: { select: artistCardSelect },
      song: { select: songCardSelect },
    },
  });
  const artists = await withFollowFlags(userId, rows.flatMap((r) => (r.artist ? [r.artist] : [])));
  const songs = await withLikeFlags(userId, rows.flatMap((r) => (r.song ? [r.song] : [])));
  const artistById = new Map(artists.map((a) => [a.id, a]));
  const songById = new Map(songs.map((s) => [s.id, s]));

  return rows.flatMap((r): RecentItem[] => {
    if (r.artist) return [{ kind: 'artist', viewedAt: r.viewedAt, artist: artistById.get(r.artist.id)! }];
    if (r.song) return [{ kind: 'song', viewedAt: r.viewedAt, song: songById.get(r.song.id)! }];
    return [];
  });
}
