import { Router } from 'express';
import { EventStatus, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound, pageMeta, paginate, paginationSchema, param, parse, webUrl } from '../../lib/http';
import { slugify, uniqueSlug } from '../../lib/slug';
import { eventCardSelect, whenFilter } from '../events/events.routes';

/** Event management. Mounted under /admin, which is already staff-only. */
export const eventsAdminRouter = Router();

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const url = z
  .union([webUrl, z.literal('')])
  .nullish()
  .transform((v) => v || null);

// The empty literal comes first in these unions: z.coerce.number() turns "" into 0,
// so an empty price field would otherwise be stored as free entry.
const optionalDate = z
  .union([z.literal(''), z.coerce.date()])
  .nullish()
  .transform((v) => (v instanceof Date ? v : null));

const eventSchema = z.object({
  title: z.string().trim().min(1).max(150),
  slug: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? slugify(v) : undefined)),
  kind: text(40),
  description: text(4000),
  startsAt: z.coerce.date(),
  endsAt: optionalDate,
  allDay: z.boolean().default(false),
  venue: text(150),
  address: text(300),
  regionId: z
    .string()
    .nullish()
    .transform((v) => v || null),
  posterUrl: url,
  ticketUrl: url,
  priceFrom: z
    .union([z.literal(''), z.coerce.number().int().min(0).max(1_000_000)])
    .nullish()
    .transform((v) => (typeof v === 'number' ? v : null)),
  status: z.nativeEnum(EventStatus).default('SCHEDULED'),
  featured: z.boolean().default(false),
  /** Lineup in billing order; the first is the headliner. */
  artistIds: z.array(z.string().min(1)).max(40).default([]),
});

const adminSelect = { ...eventCardSelect, description: true, address: true, regionId: true } satisfies Prisma.EventSelect;

/** Rejects a lineup containing artists that don't exist, rather than failing on the FK. */
async function checkArtists(artistIds: string[]) {
  if (!artistIds.length) return;
  const found = await prisma.artist.count({ where: { id: { in: artistIds } } });
  if (found !== new Set(artistIds).size) throw badRequest('One of those artists no longer exists');
}

const lineupRows = (artistIds: string[]) => artistIds.map((artistId, order) => ({ artistId, order }));

eventsAdminRouter.get('/events', async (req, res) => {
  const { page, limit, when, q } = parse(
    paginationSchema.extend({ when: z.enum(['upcoming', 'past', 'all']).default('all'), q: z.string().trim().max(80).optional() }),
    req.query,
  );
  const where: Prisma.EventWhereInput = {
    ...whenFilter(when),
    ...(q && { OR: [{ title: { contains: q, mode: 'insensitive' } }, { venue: { contains: q, mode: 'insensitive' } }] }),
  };
  const [items, total] = await Promise.all([
    prisma.event.findMany({ where, orderBy: { startsAt: 'desc' }, select: adminSelect, ...paginate(page, limit) }),
    prisma.event.count({ where }),
  ]);
  res.json({ items, meta: pageMeta(page, limit, total) });
});

eventsAdminRouter.get('/events/:id', async (req, res) => {
  const event = await prisma.event.findUnique({ where: { id: param(req, 'id') }, select: adminSelect });
  if (!event) throw notFound('Event');
  res.json({ event });
});

eventsAdminRouter.post('/events', async (req, res) => {
  const { slug, artistIds, ...data } = parse(eventSchema, req.body);
  await checkArtists(artistIds);
  const event = await prisma.event.create({
    data: {
      ...data,
      slug: await uniqueSlug(slug ?? slugify(data.title), async (s) => !!(await prisma.event.findUnique({ where: { slug: s } }))),
      lineup: { create: lineupRows(artistIds) },
    },
    select: adminSelect,
  });
  res.status(201).json({ event });
});

eventsAdminRouter.patch('/events/:id', async (req, res) => {
  const id = param(req, 'id');
  const existing = await prisma.event.findUnique({ where: { id }, select: { id: true, slug: true } });
  if (!existing) throw notFound('Event');
  const { slug, artistIds, ...data } = parse(eventSchema, req.body);
  await checkArtists(artistIds);

  // The lineup is replaced wholesale: the form always sends the full billing order.
  const event = await prisma.$transaction(async (tx) => {
    await tx.eventArtist.deleteMany({ where: { eventId: id } });
    return tx.event.update({
      where: { id },
      data: {
        ...data,
        ...(slug && slug !== existing.slug
          ? { slug: await uniqueSlug(slug, async (s) => s !== existing.slug && !!(await prisma.event.findUnique({ where: { slug: s } }))) }
          : {}),
        lineup: { create: lineupRows(artistIds) },
      },
      select: adminSelect,
    });
  });
  res.json({ event });
});

eventsAdminRouter.delete('/events/:id', async (req, res) => {
  const id = param(req, 'id');
  if (!(await prisma.event.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Event');
  await prisma.event.delete({ where: { id } }); // lineup rows cascade
  res.status(204).end();
});
