import { Router } from 'express';
import { AlbumType, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { HttpError, badRequest, conflict, notFound, parse } from '../../lib/http';
import { HANDLE_RE, autoHandle, handleAfterInstagramChange, normalizeHandle, uniqueHandle } from '../../lib/handles';
import { findCandidates, instagramUrl } from '../images/wikipedia';
import { backfillArtistImages, backfillInstagram } from '../images/backfill';
import { siteAdminRouter } from './site.admin.routes';
import { suggestionsAdminRouter } from './suggestions.admin.routes';
import { trendingIds } from '../catalog/views';
import { usersAdminRouter } from './users.admin.routes';
import { showsAdminRouter } from './shows.admin.routes';
import { slugify, uniqueSlug } from '../../lib/slug';
import { requireAuth, requireStaff } from '../../middleware/auth';
import { albumCardSelect, artistCardSelect, songCardSelect } from '../catalog/selects';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireStaff);
adminRouter.use(siteAdminRouter);
adminRouter.use(usersAdminRouter);
adminRouter.use(suggestionsAdminRouter);
adminRouter.use(showsAdminRouter);

// Empty strings from HTML forms become null.
const nullableText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
const nullableUrl = z
  .union([z.string().trim().url().max(500), z.literal('')])
  .nullish()
  .transform((v) => (v ? v : null));
const nullableDate = z
  .union([z.coerce.date(), z.literal('')])
  .nullish()
  .transform((v) => (v instanceof Date ? v : null));
const nullableInt = (min: number, max: number) =>
  z
    .union([z.coerce.number().int().min(min).max(max), z.literal('')])
    .nullish()
    .transform((v) => (typeof v === 'number' ? v : null));

/** Accepts "@handle", "handle" or a full instagram.com URL; stores a canonical profile URL. */
const instagramField = z
  .string()
  .trim()
  .max(300)
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const handle = v.match(/^@?([A-Za-z0-9._]{1,30})$/)?.[1] ?? v.match(/instagram\.com\/([A-Za-z0-9._]{1,30})/i)?.[1];
    if (!handle) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Use @handle or an instagram.com profile link' });
      return z.NEVER;
    }
    return instagramUrl(handle);
  });

/** "@Name.Here" -> "name.here"; "" means reset to automatic. */
const handleField = z
  .string()
  .trim()
  .max(40)
  .optional()
  .transform((v, ctx) => {
    if (v === undefined) return undefined;
    if (v === '' || v === '@') return '';
    const h = normalizeHandle(v);
    if (!HANDLE_RE.test(h)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Handles use letters, numbers, dots and underscores (max 30)' });
      return z.NEVER;
    }
    return h;
  });

/** Reserve an explicit handle, or explain who already has it. */
async function claimHandle(handle: string, selfId?: string) {
  const owner = await prisma.artist.findUnique({ where: { handle }, select: { id: true, name: true } });
  if (owner && owner.id !== selfId) throw conflict(`@${handle} is already used by ${owner.name}`);
  return handle;
}

const slugField = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((v) => (v ? slugify(v) : undefined));

async function slugFor<T extends 'artist' | 'album' | 'song'>(model: T, requested: string | undefined, fallback: string, selfId?: string) {
  const exists = async (slug: string) => {
    const where = { slug };
    const found =
      model === 'artist'
        ? await prisma.artist.findUnique({ where, select: { id: true } })
        : model === 'album'
          ? await prisma.album.findUnique({ where, select: { id: true } })
          : await prisma.song.findUnique({ where, select: { id: true } });
    return !!found && found.id !== selfId;
  };
  return uniqueSlug(requested || fallback, exists);
}

async function regionIdFor(slug: string | null | undefined) {
  if (slug === undefined) return undefined;
  if (!slug) return null;
  const region = await prisma.region.findUnique({ where: { slug }, select: { id: true } });
  if (!region) throw badRequest(`Unknown region "${slug}"`);
  return region.id;
}

/** Anyone credited with a beat gets the producer badge automatically. */
async function markProducers(ids: string[] | undefined) {
  if (ids?.length) await prisma.artist.updateMany({ where: { id: { in: ids }, isProducer: false }, data: { isProducer: true } });
}

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

const artistSchema = z.object({
  name: z.string().trim().min(1).max(100),
  slug: slugField,
  realName: nullableText(100),
  bio: nullableText(5000),
  imageUrl: nullableUrl,
  imageCredit: nullableText(300),
  imageSourceUrl: nullableUrl,
  bannerUrl: nullableUrl,
  activeSince: nullableInt(1970, 2100),
  verified: z.boolean().optional(),
  isProducer: z.boolean().optional(),
  featured: z.boolean().optional(),
  regionSlug: z.string().nullish(),
  genreSlugs: z.array(z.string()).optional(),
  instagramUrl: instagramField,
  youtubeUrl: nullableUrl,
  spotifyUrl: nullableUrl,
  spotifyId: nullableText(64),
  /** @handle. Omit or send "" for automatic (Instagram username, else stage_name). */
  handle: handleField,
});

adminRouter.get('/artists/:id', async (req, res) => {
  const artist = await prisma.artist.findUnique({
    where: { id: req.params.id },
    include: { genres: { select: { slug: true } }, region: { select: { slug: true } } },
  });
  if (!artist) throw notFound('Artist');
  res.json({ artist });
});

adminRouter.post('/artists', async (req, res) => {
  const { slug, regionSlug, genreSlugs, handle, ...data } = parse(artistSchema, req.body);
  const artist = await prisma.artist.create({
    data: {
      ...data,
      handle: handle ? await claimHandle(handle) : await uniqueHandle(autoHandle(data)),
      slug: await slugFor('artist', slug, data.name),
      regionId: await regionIdFor(regionSlug),
      genres: genreSlugs ? { connect: genreSlugs.map((s) => ({ slug: s })) } : undefined,
    },
    select: artistCardSelect,
  });
  res.status(201).json({ artist });
});

adminRouter.patch('/artists/:id', async (req, res) => {
  const { slug, regionSlug, genreSlugs, handle, ...data } = parse(artistSchema.partial(), req.body);
  const id = req.params.id;
  const current = await prisma.artist.findUnique({ where: { id }, select: { id: true, name: true, handle: true, instagramUrl: true } });
  if (!current) throw notFound('Artist');

  let nextHandle: string | undefined;
  if (handle) nextHandle = handle === current.handle ? undefined : await claimHandle(handle, id);
  else if (handle === '') nextHandle = await uniqueHandle(autoHandle({ name: data.name ?? current.name, instagramUrl: data.instagramUrl ?? current.instagramUrl }), id);
  else if (data.instagramUrl !== undefined && data.instagramUrl !== current.instagramUrl)
    nextHandle = await handleAfterInstagramChange(current, data.instagramUrl);

  const artist = await prisma.artist.update({
    where: { id },
    data: {
      ...data,
      ...(nextHandle && { handle: nextHandle }),
      ...(slug && { slug: await slugFor('artist', slug, slug, req.params.id) }),
      ...(regionSlug !== undefined && { regionId: await regionIdFor(regionSlug) }),
      ...(genreSlugs && { genres: { set: genreSlugs.map((s) => ({ slug: s })) } }),
    },
    select: artistCardSelect,
  });
  res.json({ artist });
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

const albumSchema = z.object({
  title: z.string().trim().min(1).max(150),
  slug: slugField,
  artistId: z.string().min(1),
  type: z.nativeEnum(AlbumType).optional(),
  releaseDate: nullableDate,
  coverUrl: nullableUrl,
  spotifyId: nullableText(64),
});

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
  const { slug, ...data } = parse(albumSchema, req.body);
  const artist = await prisma.artist.findUnique({ where: { id: data.artistId }, select: { name: true } });
  if (!artist) throw badRequest('Unknown artist');
  const album = await prisma.album.create({
    data: { ...data, slug: await slugFor('album', slug, `${artist.name} ${data.title}`) },
    select: albumCardSelect,
  });
  res.status(201).json({ album });
});

adminRouter.patch('/albums/:id', async (req, res) => {
  const { slug, ...data } = parse(albumSchema.partial(), req.body);
  const album = await prisma.album.update({
    where: { id: req.params.id },
    data: { ...data, ...(slug && { slug: await slugFor('album', slug, slug, req.params.id) }) },
    select: albumCardSelect,
  });
  res.json({ album });
});

adminRouter.delete('/albums/:id', async (req, res) => {
  await prisma.album.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ---------- Songs ----------

const songSchema = z.object({
  title: z.string().trim().min(1).max(150),
  slug: slugField,
  artistId: z.string().min(1),
  albumId: z
    .string()
    .nullish()
    .transform((v) => (v ? v : null)),
  trackNumber: nullableInt(1, 500),
  releaseDate: nullableDate,
  durationSec: nullableInt(1, 60 * 60),
  coverUrl: nullableUrl,
  explicit: z.boolean().optional(),
  genreSlugs: z.array(z.string()).optional(),
  featureArtistIds: z.array(z.string()).optional(),
  /** Beat / production credits (the primary artist may self-produce). */
  producerArtistIds: z.array(z.string()).max(10).optional(),
  spotifyTrackId: nullableText(64),
  youtubeVideoId: nullableText(32),
  lyricsUrl: nullableUrl,
});

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
  const { slug, genreSlugs, featureArtistIds, producerArtistIds, ...data } = parse(songSchema, req.body);
  const artist = await prisma.artist.findUnique({ where: { id: data.artistId }, select: { name: true } });
  if (!artist) throw badRequest('Unknown artist');

  const song = await prisma.song.create({
    data: {
      ...data,
      slug: await slugFor('song', slug, `${artist.name} ${data.title}`),
      genres: genreSlugs ? { connect: genreSlugs.map((s) => ({ slug: s })) } : undefined,
      features: featureArtistIds?.length
        ? { create: featureArtistIds.filter((id) => id !== data.artistId).map((artistId) => ({ artistId })) }
        : undefined,
      producers: producerArtistIds?.length ? { create: [...new Set(producerArtistIds)].map((artistId) => ({ artistId })) } : undefined,
    },
    select: songCardSelect,
  });
  await markProducers(producerArtistIds);
  res.status(201).json({ song });
});

adminRouter.patch('/songs/:id', async (req, res) => {
  const { slug, genreSlugs, featureArtistIds, producerArtistIds, ...data } = parse(songSchema.partial(), req.body);
  const id = req.params.id;
  // Resolved before the transaction: slugFor uses the global client and would otherwise
  // wait for the connection the transaction is holding (deadlock on small pools).
  const newSlug = slug ? await slugFor('song', slug, slug, id) : undefined;
  const primaryArtistId =
    data.artistId ?? (await prisma.song.findUnique({ where: { id }, select: { artistId: true } }))?.artistId;

  const song = await prisma.$transaction(async (tx) => {
    if (featureArtistIds) {
      await tx.songFeature.deleteMany({ where: { songId: id } });
    }
    if (producerArtistIds) {
      await tx.songProducer.deleteMany({ where: { songId: id } });
    }
    return tx.song.update({
      where: { id },
      data: {
        ...data,
        ...(newSlug && { slug: newSlug }),
        ...(genreSlugs && { genres: { set: genreSlugs.map((s) => ({ slug: s })) } }),
        ...(featureArtistIds && {
          features: {
            create: [...new Set(featureArtistIds)].filter((a) => a !== primaryArtistId).map((artistId) => ({ artistId })),
          },
        }),
        ...(producerArtistIds && {
          producers: { create: [...new Set(producerArtistIds)].map((artistId) => ({ artistId })) },
        }),
      },
      select: songCardSelect,
    });
  });
  await markProducers(producerArtistIds);
  res.json({ song });
});

adminRouter.delete('/songs/:id', async (req, res) => {
  await prisma.song.delete({ where: { id: req.params.id } });
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
