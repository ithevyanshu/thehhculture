import { Router } from 'express';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound, pageMeta, paginate, paginationSchema, param, parse } from '../../lib/http';
import { currentUser } from '../../middleware/auth';
import { getSiteConfig, saveSetting, studioSchema } from '../site/config';
import { applyChange, changeSelect } from '../studio/studio.service';

/** Artist Studio administration: account links, the change review queue, auto-publish settings. */
export const studioAdminRouter = Router();

const artistRef = { select: { id: true, slug: true, name: true, handle: true, imageUrl: true } } as const;
const userRef = { select: { id: true, username: true, displayName: true, email: true, role: true } } as const;

// ---------- Settings ----------

studioAdminRouter.get('/studio/settings', async (_req, res) => {
  res.json((await getSiteConfig()).studio);
});

studioAdminRouter.put('/studio/settings', async (req, res) => {
  const value = parse(studioSchema, req.body);
  await saveSetting('studio', value, currentUser(req).id);
  res.json(value);
});

// ---------- Account links (one account per artist, one artist per account) ----------

studioAdminRouter.get('/studio/links', async (_req, res) => {
  const items = await prisma.artist.findMany({
    where: { managedById: { not: null } },
    orderBy: { name: 'asc' },
    select: { ...artistRef.select, managedBy: userRef },
  });
  res.json({ items });
});

/** Account search for the link picker (Studio permission doesn't include the Users section). */
studioAdminRouter.get('/studio/users', async (req, res) => {
  const { q } = parse(z.object({ q: z.string().trim().min(1).max(100) }), req.query);
  const items = await prisma.user.findMany({
    where: {
      disabled: false,
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    },
    take: 10,
    select: { ...userRef.select, managedArtist: { select: { id: true, name: true } } },
  });
  res.json({ items });
});

studioAdminRouter.put('/studio/links/:artistId', async (req, res) => {
  const artistId = param(req, 'artistId');
  const { userId } = parse(z.object({ userId: z.string().min(1) }), req.body);
  const [artist, user] = await Promise.all([
    prisma.artist.findUnique({ where: { id: artistId }, select: { name: true, managedById: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { role: true, disabled: true, managedArtist: { select: { name: true } } } }),
  ]);
  if (!artist) throw notFound('Artist');
  if (!user || user.disabled) throw badRequest('Pick an active account');
  if (artist.managedById && artist.managedById !== userId) throw conflict(`${artist.name} is already linked to another account. Unlink it first.`);
  if (user.managedArtist && artist.managedById !== userId) throw conflict(`That account already runs ${user.managedArtist.name}`);

  await prisma.$transaction([
    prisma.artist.update({ where: { id: artistId }, data: { managedById: userId } }),
    // Regular accounts become artist accounts; staff keep their role.
    ...(user.role === Role.USER ? [prisma.user.update({ where: { id: userId }, data: { role: Role.ARTIST } })] : []),
  ]);
  res.status(204).end();
});

studioAdminRouter.delete('/studio/links/:artistId', async (req, res) => {
  const artistId = param(req, 'artistId');
  const artist = await prisma.artist.findUnique({ where: { id: artistId }, select: { managedById: true } });
  if (!artist) throw notFound('Artist');
  if (artist.managedById) {
    await prisma.$transaction([
      prisma.artist.update({ where: { id: artistId }, data: { managedById: null } }),
      prisma.user.updateMany({ where: { id: artist.managedById, role: Role.ARTIST }, data: { role: Role.USER } }),
    ]);
  }
  res.status(204).end();
});

// ---------- Review queue ----------

/** Current values of what an update would change, so reviewers can compare. */
async function currentFor(change: { action: string; artistId: string; targetId: string | null; payload: Prisma.JsonValue }) {
  const keys = Object.keys((change.payload ?? {}) as object);
  if (change.action === 'PROFILE_UPDATE') {
    const artist = await prisma.artist.findUnique({
      where: { id: change.artistId },
      include: { genres: { select: { slug: true } }, region: { select: { slug: true } } },
    });
    if (!artist) return null;
    const flat: Record<string, unknown> = { ...artist, genreSlugs: artist.genres.map((g) => g.slug), regionSlug: artist.region?.slug ?? null };
    return Object.fromEntries(keys.map((k) => [k, flat[k] ?? null]));
  }
  if (change.action === 'SONG_UPDATE' && change.targetId) {
    const song = await prisma.song.findUnique({
      where: { id: change.targetId },
      include: { genres: { select: { slug: true } }, features: { select: { artistId: true } }, producers: { select: { artistId: true } } },
    });
    if (!song) return null;
    const flat: Record<string, unknown> = {
      ...song,
      genreSlugs: song.genres.map((g) => g.slug),
      featureArtistIds: song.features.map((f) => f.artistId),
      producerArtistIds: song.producers.map((p) => p.artistId),
    };
    return Object.fromEntries(keys.map((k) => [k, flat[k] ?? null]));
  }
  if (change.action === 'ALBUM_UPDATE' && change.targetId) {
    const album = await prisma.album.findUnique({ where: { id: change.targetId } });
    return album ? Object.fromEntries(keys.map((k) => [k, (album as Record<string, unknown>)[k] ?? null])) : null;
  }
  return null;
}

studioAdminRouter.get('/studio/changes', async (req, res) => {
  const { page, limit, status } = parse(
    paginationSchema.extend({ status: z.enum(['PENDING', 'APPLIED', 'REJECTED']).default('PENDING') }),
    req.query,
  );
  const where = { status };
  const [rows, total, pending] = await Promise.all([
    prisma.artistChange.findMany({
      where,
      orderBy: { createdAt: status === 'PENDING' ? 'asc' : 'desc' }, // oldest first while reviewing
      select: { ...changeSelect, artistId: true, artist: artistRef, author: userRef, reviewedBy: { select: { username: true } } },
      ...paginate(page, limit),
    }),
    prisma.artistChange.count({ where }),
    prisma.artistChange.count({ where: { status: 'PENDING' } }),
  ]);
  const items = await Promise.all(rows.map(async (c) => ({ ...c, current: c.status === 'PENDING' ? await currentFor(c) : null })));

  // Names for ids inside payloads (credited artists, albums), so reviewers see "Karan Kanchan", not an id.
  const artistIds = new Set<string>();
  const albumIds = new Set<string>();
  for (const c of items) {
    for (const obj of [c.payload, c.current] as Record<string, unknown>[]) {
      if (!obj) continue;
      for (const k of ['featureArtistIds', 'producerArtistIds']) (obj[k] as string[] | undefined)?.forEach((id) => artistIds.add(id));
      if (typeof obj.albumId === 'string') albumIds.add(obj.albumId);
    }
  }
  const [artists, albums] = await Promise.all([
    prisma.artist.findMany({ where: { id: { in: [...artistIds] } }, select: { id: true, name: true } }),
    prisma.album.findMany({ where: { id: { in: [...albumIds] } }, select: { id: true, title: true } }),
  ]);
  res.json({
    items,
    meta: pageMeta(page, limit, total),
    pending,
    names: Object.fromEntries([...artists.map((a) => [a.id, a.name]), ...albums.map((a) => [a.id, a.title])]),
  });
});

async function pendingChange(id: string) {
  const change = await prisma.artistChange.findUnique({ where: { id } });
  if (!change) throw notFound('Change');
  if (change.status !== 'PENDING') throw badRequest('This change was already reviewed');
  return change;
}

studioAdminRouter.post('/studio/changes/:id/approve', async (req, res) => {
  const change = await pendingChange(param(req, 'id'));
  await applyChange(change); // throws a readable 4xx if it no longer applies (e.g. song deleted since)
  await prisma.artistChange.update({
    where: { id: change.id },
    data: { status: 'APPLIED', reviewedById: currentUser(req).id, reviewedAt: new Date() },
  });
  res.status(204).end();
});

studioAdminRouter.post('/studio/changes/:id/reject', async (req, res) => {
  const change = await pendingChange(param(req, 'id'));
  const { note } = parse(z.object({ note: z.string().trim().max(500).optional() }), req.body ?? {});
  await prisma.artistChange.update({
    where: { id: change.id },
    data: { status: 'REJECTED', reviewNote: note || null, reviewedById: currentUser(req).id, reviewedAt: new Date() },
  });
  res.status(204).end();
});
