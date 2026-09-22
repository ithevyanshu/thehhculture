import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { notFound, pageMeta, paginate, paginationSchema, param, parse } from '../../lib/http';
import { z } from 'zod';

/** Live events: gigs, festivals, tour dates, battles and launches. */
export const eventsRouter = Router();

export const eventCardSelect = {
  id: true,
  slug: true,
  title: true,
  kind: true,
  startsAt: true,
  endsAt: true,
  allDay: true,
  venue: true,
  posterUrl: true,
  ticketUrl: true,
  priceFrom: true,
  status: true,
  featured: true,
  region: { select: { slug: true, name: true } },
  lineup: {
    orderBy: { order: 'asc' as const },
    select: { order: true, artist: { select: { id: true, slug: true, name: true, handle: true, imageUrl: true } } },
  },
} satisfies Prisma.EventSelect;

const eventDetailSelect = { ...eventCardSelect, description: true, address: true } satisfies Prisma.EventSelect;

/**
 * An event counts as upcoming for the whole of its last day, so a gig tonight doesn't
 * drop off the list at midday. Multi-day events stay up until they finish.
 */
function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

export function whenFilter(when: 'upcoming' | 'past' | 'all'): Prisma.EventWhereInput {
  if (when === 'all') return {};
  const today = startOfToday();
  return when === 'upcoming'
    ? { OR: [{ startsAt: { gte: today } }, { endsAt: { gte: today } }] }
    : { startsAt: { lt: today }, OR: [{ endsAt: null }, { endsAt: { lt: today } }] };
}

const listQuery = paginationSchema.extend({
  when: z.enum(['upcoming', 'past', 'all']).default('upcoming'),
  /** Region slug, so /events?city=mumbai works like the rest of the site. */
  city: z.string().trim().max(60).optional(),
  artist: z.string().trim().max(60).optional(),
});

eventsRouter.get('/', async (req, res) => {
  const { page, limit, when, city, artist } = parse(listQuery, req.query);
  const where: Prisma.EventWhereInput = {
    ...whenFilter(when),
    ...(city && { region: { slug: city } }),
    ...(artist && { lineup: { some: { artist: { slug: artist } } } }),
  };
  // Upcoming reads forwards from today; past reads backwards from the most recent.
  const orderBy: Prisma.EventOrderByWithRelationInput[] =
    when === 'past' ? [{ startsAt: 'desc' }] : [{ startsAt: 'asc' }];

  const [items, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy, select: eventCardSelect, ...paginate(page, limit) }),
    prisma.event.count({ where }),
  ]);
  res.json({ items, meta: pageMeta(page, limit, total) });
});

eventsRouter.get('/:slug', async (req, res) => {
  const event = await prisma.event.findUnique({ where: { slug: param(req, 'slug') }, select: eventDetailSelect });
  if (!event) throw notFound('Event');

  // Other dates on the same bill: same city first, then anything else coming up.
  const artistIds = event.lineup.map((l) => l.artist.id);
  const related = await prisma.event.findMany({
    where: {
      id: { not: event.id },
      ...whenFilter('upcoming'),
      ...(artistIds.length ? { lineup: { some: { artistId: { in: artistIds } } } } : {}),
    },
    orderBy: { startsAt: 'asc' },
    take: 4,
    select: eventCardSelect,
  });
  res.json({ event, related });
});

/** Upcoming dates for one artist, used by the artist page and the home block. */
export function upcomingForArtists(artistIds: string[], take = 12) {
  if (!artistIds.length) return Promise.resolve([]);
  return prisma.event.findMany({
    where: { ...whenFilter('upcoming'), status: { not: 'CANCELLED' }, lineup: { some: { artistId: { in: artistIds } } } },
    orderBy: { startsAt: 'asc' },
    take,
    select: eventCardSelect,
  });
}

/** What's on next, for the home page. */
export function upcomingEvents(take = 12) {
  return prisma.event.findMany({
    where: { ...whenFilter('upcoming'), status: { not: 'CANCELLED' } },
    orderBy: [{ featured: 'desc' }, { startsAt: 'asc' }],
    take,
    select: eventCardSelect,
  });
}
