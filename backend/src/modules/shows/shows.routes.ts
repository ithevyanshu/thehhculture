import { Router } from 'express';
import { Prisma, ShowRole } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound, param } from '../../lib/http';
import { optionalAuth } from '../../middleware/auth';
import { artistCardSelect, withFollowFlags } from '../catalog/selects';

/** Rap shows (Hustle, Legacy, ...) with seasons and cast. */
export const showsRouter = Router();

/** Podium first, then panel, then everyone else. */
export const ROLE_ORDER: ShowRole[] = ['WINNER', 'RUNNER_UP', 'FINALIST', 'FEATURED', 'JUDGE', 'GUEST_JUDGE', 'HOST', 'CONTESTANT'];

export const showCardSelect = {
  id: true,
  slug: true,
  name: true,
  network: true,
  description: true,
  logoUrl: true,
  _count: { select: { seasons: true } },
  seasons: {
    orderBy: { number: 'desc' as const },
    take: 1,
    select: {
      number: true,
      year: true,
      title: true,
      cast: {
        where: { role: { in: [ShowRole.WINNER, ShowRole.FEATURED] } },
        select: { role: true, artist: { select: { id: true, slug: true, name: true, handle: true, imageUrl: true } } },
      },
    },
  },
} satisfies Prisma.ShowSelect;

/** "3rd" -> 3, "6-10" -> 6, "Top 16 / active" -> 16, unknown -> last. */
export function placementRank(p: string | null) {
  const n = p?.match(/\d+/)?.[0];
  return n ? Number(n) : 999;
}

/** All shows with their latest season's winner(s). */
export async function listShows() {
  const shows = await prisma.show.findMany({ orderBy: { name: 'asc' }, select: showCardSelect });
  return shows.map(({ seasons, ...show }) => ({ ...show, latestSeason: seasons[0] ?? null }));
}

showsRouter.get('/', async (_req, res) => {
  res.json({ items: await listShows() });
});

showsRouter.get('/:slug', optionalAuth, async (req, res) => {
  const show = await prisma.show.findUnique({
    where: { slug: param(req, 'slug') },
    select: {
      id: true,
      slug: true,
      name: true,
      network: true,
      description: true,
      logoUrl: true,
      seasons: {
        orderBy: { number: 'desc' },
        select: {
          id: true,
          number: true,
          year: true,
          title: true,
          cast: { select: { role: true, placement: true, artist: { select: artistCardSelect } } },
        },
      },
    },
  });
  if (!show) throw notFound('Show');

  // Follow flags for everyone in the cast, in one query.
  const artists = show.seasons.flatMap((s) => s.cast.map((c) => c.artist));
  const flagged = new Map((await withFollowFlags(req.user?.id, artists)).map((a) => [a.id, a]));

  res.json({
    show: {
      ...show,
      seasons: show.seasons.map((s) => ({
        ...s,
        cast: [...s.cast]
          .sort(
            (a, b) =>
              ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) ||
              placementRank(a.placement) - placementRank(b.placement) ||
              a.artist.name.localeCompare(b.artist.name),
          )
          .map((c) => ({ role: c.role, placement: c.placement, artist: flagged.get(c.artist.id)! })),
      })),
    },
  });
});
