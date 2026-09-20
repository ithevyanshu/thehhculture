import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError, notFound, parse, param } from '../../lib/http';
import { findCandidates } from '../images/wikipedia';
import { backfillArtistImages, backfillInstagram } from '../images/backfill';
import { siteAdminRouter } from './site.admin.routes';
import { suggestionsAdminRouter } from './suggestions.admin.routes';
import { trendingIds } from '../catalog/views';
import { usersAdminRouter } from './users.admin.routes';
import { showsAdminRouter } from './shows.admin.routes';
import { studioAdminRouter } from './studio.admin.routes';
import { importAdminRouter } from './import.admin.routes';
import { sheetsAdminRouter } from './sheets.admin.routes';
import { slugify } from '../../lib/slug';
import { requireAuth, requireStaff } from '../../middleware/auth';
import { albumCardSelect } from '../catalog/selects';
import {
  albumSchema,
  artistSchema,
  createAlbum,
  createArtist,
  createSong,
  deleteAlbum,
  deleteSong,
  nullableText,
  slugField,
  songSchema,
  updateAlbum,
  updateArtist,
  updateSong,
} from '../catalog/editor';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireStaff);
adminRouter.use(siteAdminRouter);
adminRouter.use(usersAdminRouter);
adminRouter.use(suggestionsAdminRouter);
adminRouter.use(showsAdminRouter);
adminRouter.use(studioAdminRouter);
adminRouter.use(importAdminRouter);
adminRouter.use(sheetsAdminRouter);

// ---------- Dashboard ----------

adminRouter.get('/stats', async (_req, res) => {
  const [users, artists, albums, songs, playlists, follows, likes] = await Promise.all([
    prisma.user.count(),
    prisma.artist.count(),
    prisma.album.count(),
    prisma.song.count(),
    prisma.playlist.count(),
    prisma.follow.count(),
    prisma.songLike.count(),
  ]);
  const [ranked, newSuggestions] = await Promise.all([trendingIds({}), prisma.suggestion.count({ where: { status: 'NEW' } })]);
  const artistRefs = await prisma.artist.findMany({
    where: { id: { in: ranked.map((r) => r.id) } },
    select: { id: true, slug: true, name: true, imageUrl: true },
  });
  const refById = new Map(artistRefs.map((a) => [a.id, a]));
  const withRef = (list: typeof ranked) => list.flatMap((r) => (refById.has(r.id) ? [{ ...refById.get(r.id)!, week: r.week, allTime: r.allTime }] : []));

  res.json({
    counts: { users, artists, albums, songs, playlists, follows, likes },
    newSuggestions,
    views: {
      week: ranked.reduce((n, r) => n + r.week, 0),
      allTime: ranked.reduce((n, r) => n + r.allTime, 0),
    },
    topArtists: {
      week: withRef(ranked.filter((r) => r.week > 0).slice(0, 10)),
      allTime: withRef([...ranked].sort((a, b) => b.allTime - a.allTime).filter((r) => r.allTime > 0).slice(0, 10)),
    },
  });
});

// ---------- Artists ----------

adminRouter.get('/artists/:id', async (req, res) => {
  const artist = await prisma.artist.findUnique({
    where: { id: param(req, 'id') },
    include: { genres: { select: { slug: true } }, region: { select: { slug: true } } },
  });
  if (!artist) throw notFound('Artist');
  res.json({ artist });
});

adminRouter.post('/artists', async (req, res) => {
  res.status(201).json({ artist: await createArtist(parse(artistSchema, req.body)) });
});

adminRouter.patch('/artists/:id', async (req, res) => {
  res.json({ artist: await updateArtist(param(req, 'id'), parse(artistSchema.partial(), req.body)) });
});

// ---------- Artist images (Wikipedia / Wikimedia Commons) ----------

/** Candidates for the admin picker. `query` may be a search phrase or a Wikipedia URL. */
adminRouter.post('/images/search', async (req, res) => {
  const { query } = parse(z.object({ query: z.string().trim().min(1).max(200) }), req.body);
  try {
    res.json({ candidates: await findCandidates(query) });
  } catch (err) {
    throw new HttpError(502, `Wikipedia lookup failed: ${err instanceof Error ? err.message : 'unknown error'}`);
  }
});

/** Auto-match photos for artists (only those missing one unless overwrite=true). */
adminRouter.post('/artists/images/fetch', async (req, res) => {
  const { overwrite } = parse(z.object({ overwrite: z.boolean().default(false) }), req.body ?? {});
  res.json({ results: await backfillArtistImages({ overwrite }) });
});

/** Fill Instagram links from Wikidata (only artists missing one unless overwrite=true). */
adminRouter.post('/artists/instagram/fetch', async (req, res) => {
  const { overwrite } = parse(z.object({ overwrite: z.boolean().default(false) }), req.body ?? {});
  res.json({ results: await backfillInstagram({ overwrite }) });
});

adminRouter.delete('/artists/:id', async (req, res) => {
  await prisma.artist.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ---------- Albums ----------

adminRouter.get('/albums', async (req, res) => {
  const { artistId, q } = parse(z.object({ artistId: z.string().optional(), q: z.string().optional() }), req.query);
  const items = await prisma.album.findMany({
    where: {
      ...(artistId && { artistId }),
      ...(q && { title: { contains: q, mode: 'insensitive' } }),
    },
    orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
    take: 200,
    select: albumCardSelect,
  });
  res.json({ items });
});

adminRouter.get('/albums/:id', async (req, res) => {
  const album = await prisma.album.findUnique({ where: { id: req.params.id } });
  if (!album) throw notFound('Album');
  res.json({ album });
});

adminRouter.post('/albums', async (req, res) => {
  res.status(201).json({ album: await createAlbum(parse(albumSchema, req.body)) });
});

adminRouter.patch('/albums/:id', async (req, res) => {
  res.json({ album: await updateAlbum(param(req, 'id'), parse(albumSchema.partial(), req.body)) });
});

adminRouter.delete('/albums/:id', async (req, res) => {
  await deleteAlbum(param(req, 'id'));
  res.status(204).end();
});

// ---------- Songs ----------

adminRouter.get('/songs/:id', async (req, res) => {
  const song = await prisma.song.findUnique({
    where: { id: req.params.id },
    include: {
      genres: { select: { slug: true } },
      features: { select: { artist: { select: { id: true, slug: true, name: true, handle: true } } } },
      producers: { select: { artist: { select: { id: true, slug: true, name: true, handle: true } } } },
    },
  });
  if (!song) throw notFound('Song');
  res.json({ song });
});

adminRouter.post('/songs', async (req, res) => {
  res.status(201).json({ song: await createSong(parse(songSchema, req.body)) });
});

adminRouter.patch('/songs/:id', async (req, res) => {
  res.json({ song: await updateSong(param(req, 'id'), parse(songSchema.partial(), req.body)) });
});

adminRouter.delete('/songs/:id', async (req, res) => {
  await deleteSong(param(req, 'id'));
  res.status(204).end();
});

// ---------- Taxonomy ----------

const taxonomySchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: slugField,
  description: nullableText(500),
});

adminRouter.post('/genres', async (req, res) => {
  const { slug, ...data } = parse(taxonomySchema, req.body);
  const genre = await prisma.genre.create({ data: { ...data, slug: slug || slugify(data.name) } });
  res.status(201).json({ genre });
});

adminRouter.delete('/genres/:id', async (req, res) => {
  await prisma.genre.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

adminRouter.post('/regions', async (req, res) => {
  const { name, slug, state } = parse(
    z.object({ name: z.string().trim().min(1).max(60), slug: slugField, state: nullableText(60) }),
    req.body,
  );
  const region = await prisma.region.create({ data: { name, state, slug: slug || slugify(name) } });
  res.status(201).json({ region });
});

adminRouter.delete('/regions/:id', async (req, res) => {
  await prisma.region.delete({ where: { id: req.params.id } });
  res.status(204).end();
});
