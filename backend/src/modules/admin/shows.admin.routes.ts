import { Router } from 'express';
import { ShowRole } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound, param, parse } from '../../lib/http';
import { slugify, uniqueSlug } from '../../lib/slug';
import { listShows } from '../shows/shows.routes';

/** Rap show management. Mounted under /admin (already admin-only). */
export const showsAdminRouter = Router();

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

const showSchema = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? slugify(v) : undefined)),
  network: text(60),
  description: text(2000),
  logoUrl: z
    .union([z.string().trim().url().max(500), z.literal('')])
    .nullish()
    .transform((v) => v || null),
});

const seasonSchema = z.object({
  number: z.coerce.number().int().min(1).max(100),
  year: z
    .union([z.coerce.number().int().min(1990).max(2100), z.literal('')])
    .nullish()
    .transform((v) => (typeof v === 'number' ? v : null)),
  title: text(80),
});

const showSlugExists = async (slug: string, selfId?: string) => {
  const found = await prisma.show.findUnique({ where: { slug }, select: { id: true } });
  return !!found && found.id !== selfId;
};

showsAdminRouter.get('/shows', async (_req, res) => {
  res.json({ items: await listShows() });
});

/** Full show for the editor: seasons with cast ids + names. */
showsAdminRouter.get('/shows/:id', async (req, res) => {
  const show = await prisma.show.findUnique({
    where: { id: param(req, 'id') },
    include: {
      seasons: {
        orderBy: { number: 'desc' },
        include: { cast: { select: { role: true, placement: true, artist: { select: { id: true, slug: true, name: true, handle: true, imageUrl: true } } } } },
      },
    },
  });
  if (!show) throw notFound('Show');
  res.json({ show });
});

showsAdminRouter.post('/shows', async (req, res) => {
  const { slug, ...data } = parse(showSchema, req.body);
  const show = await prisma.show.create({
    data: { ...data, slug: await uniqueSlug(slug || data.name, (s) => showSlugExists(s)) },
  });
  res.status(201).json({ show });
});

showsAdminRouter.patch('/shows/:id', async (req, res) => {
  const id = param(req, 'id');
  const { slug, ...data } = parse(showSchema.partial(), req.body);
  const show = await prisma.show.update({
    where: { id },
    data: { ...data, ...(slug && { slug: await uniqueSlug(slug, (s) => showSlugExists(s, id)) }) },
  });
  res.json({ show });
});

showsAdminRouter.delete('/shows/:id', async (req, res) => {
  await prisma.show.delete({ where: { id: param(req, 'id') } });
  res.status(204).end();
});

// ---------- Seasons ----------

showsAdminRouter.post('/shows/:id/seasons', async (req, res) => {
  const showId = param(req, 'id');
  const data = parse(seasonSchema, req.body);
  const clash = await prisma.showSeason.findUnique({ where: { showId_number: { showId, number: data.number } }, select: { id: true } });
  if (clash) throw conflict(`Season ${data.number} already exists for this show`);
  const season = await prisma.showSeason.create({ data: { ...data, showId } });
  res.status(201).json({ season });
});

showsAdminRouter.patch('/seasons/:id', async (req, res) => {
  const season = await prisma.showSeason.update({ where: { id: param(req, 'id') }, data: parse(seasonSchema.partial(), req.body) });
  res.json({ season });
});

showsAdminRouter.delete('/seasons/:id', async (req, res) => {
  await prisma.showSeason.delete({ where: { id: param(req, 'id') } });
  res.status(204).end();
});

/** Replace a season's whole cast in one go (the editor sends the full list). */
showsAdminRouter.put('/seasons/:id/cast', async (req, res) => {
  const seasonId = param(req, 'id');
  const { cast } = parse(
    z.object({
      cast: z
        .array(
          z.object({
            artistId: z.string().min(1),
            role: z.nativeEnum(ShowRole),
            placement: z
              .string()
              .trim()
              .max(40)
              .nullish()
              .transform((v) => v || null),
          }),
        )
        .max(200),
    }),
    req.body,
  );
  const unique = [...new Map(cast.map((c) => [`${c.artistId}:${c.role}`, c])).values()];
  const found = await prisma.artist.count({ where: { id: { in: [...new Set(unique.map((c) => c.artistId))] } } });
  if (found !== new Set(unique.map((c) => c.artistId)).size) throw badRequest('Some artists no longer exist');

  await prisma.$transaction([
    prisma.showAppearance.deleteMany({ where: { seasonId } }),
    prisma.showAppearance.createMany({ data: unique.map((c) => ({ ...c, seasonId })) }),
  ]);
  res.json({ ok: true, count: unique.length });
});
