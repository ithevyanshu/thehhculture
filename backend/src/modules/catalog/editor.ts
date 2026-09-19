/**
 * Catalog writes shared by the admin panel, the Artist Studio and Studio approvals:
 * input schemas plus create/update/delete for artists, albums and songs.
 */
import { AlbumType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, notFound } from '../../lib/http';
import { HANDLE_RE, autoHandle, handleAfterInstagramChange, normalizeHandle, uniqueHandle } from '../../lib/handles';
import { slugify, uniqueSlug } from '../../lib/slug';
import { instagramUrl } from '../images/wikipedia';
import { albumCardSelect, artistCardSelect, songCardSelect } from './selects';

// ---------- Field helpers ----------

// Empty strings from HTML forms become null.
export const nullableText = (max = 500) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
export const nullableUrl = z
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

export const slugField = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((v) => (v ? slugify(v) : undefined));

/** Reserve an explicit handle, or explain who already has it. */
async function claimHandle(handle: string, selfId?: string) {
  const owner = await prisma.artist.findUnique({ where: { handle }, select: { id: true, name: true } });
  if (owner && owner.id !== selfId) throw conflict(`@${handle} is already used by ${owner.name}`);
  return handle;
}

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

// ---------- Artists ----------

export const artistSchema = z.object({
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
export type ArtistInput = z.output<typeof artistSchema>;

export async function createArtist(input: ArtistInput) {
  const { slug, regionSlug, genreSlugs, handle, ...data } = input;
  return prisma.artist.create({
    data: {
      ...data,
      handle: handle ? await claimHandle(handle) : await uniqueHandle(autoHandle(data)),
      slug: await slugFor('artist', slug, data.name),
      regionId: await regionIdFor(regionSlug),
      genres: genreSlugs ? { connect: genreSlugs.map((s) => ({ slug: s })) } : undefined,
    },
    select: artistCardSelect,
  });
}

export async function updateArtist(id: string, input: Partial<ArtistInput>) {
  const { slug, regionSlug, genreSlugs, handle, ...data } = input;
  const current = await prisma.artist.findUnique({ where: { id }, select: { id: true, name: true, handle: true, instagramUrl: true } });
  if (!current) throw notFound('Artist');

  let nextHandle: string | undefined;
  if (handle) nextHandle = handle === current.handle ? undefined : await claimHandle(handle, id);
  else if (handle === '') nextHandle = await uniqueHandle(autoHandle({ name: data.name ?? current.name, instagramUrl: data.instagramUrl ?? current.instagramUrl }), id);
  else if (data.instagramUrl !== undefined && data.instagramUrl !== current.instagramUrl)
    nextHandle = await handleAfterInstagramChange(current, data.instagramUrl);

  return prisma.artist.update({
    where: { id },
    data: {
      ...data,
      ...(nextHandle && { handle: nextHandle }),
      ...(slug && { slug: await slugFor('artist', slug, slug, id) }),
      ...(regionSlug !== undefined && { regionId: await regionIdFor(regionSlug) }),
      ...(genreSlugs && { genres: { set: genreSlugs.map((s) => ({ slug: s })) } }),
    },
    select: artistCardSelect,
  });
}

// ---------- Albums ----------

export const albumSchema = z.object({
  title: z.string().trim().min(1).max(150),
  slug: slugField,
  artistId: z.string().min(1),
  type: z.nativeEnum(AlbumType).optional(),
  releaseDate: nullableDate,
  coverUrl: nullableUrl,
  spotifyId: nullableText(64),
});
export type AlbumInput = z.output<typeof albumSchema>;

export async function createAlbum(input: AlbumInput) {
  const { slug, ...data } = input;
  const artist = await prisma.artist.findUnique({ where: { id: data.artistId }, select: { name: true } });
  if (!artist) throw badRequest('Unknown artist');
  return prisma.album.create({
    data: { ...data, slug: await slugFor('album', slug, `${artist.name} ${data.title}`) },
    select: albumCardSelect,
  });
}

export async function updateAlbum(id: string, input: Partial<AlbumInput>) {
  const { slug, ...data } = input;
  return prisma.album.update({
    where: { id },
    data: { ...data, ...(slug && { slug: await slugFor('album', slug, slug, id) }) },
    select: albumCardSelect,
  });
}

export async function deleteAlbum(id: string) {
  await prisma.album.delete({ where: { id } });
}

// ---------- Songs ----------

export const songSchema = z.object({
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
export type SongInput = z.output<typeof songSchema>;

export async function createSong(input: SongInput) {
  const { slug, genreSlugs, featureArtistIds, producerArtistIds, ...data } = input;
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
  return song;
}

export async function updateSong(id: string, input: Partial<SongInput>) {
  const { slug, genreSlugs, featureArtistIds, producerArtistIds, ...data } = input;
  // Resolved before the transaction: slugFor uses the global client and would otherwise
  // wait for the connection the transaction is holding (deadlock on small pools).
  const newSlug = slug ? await slugFor('song', slug, slug, id) : undefined;
  const primaryArtistId = data.artistId ?? (await prisma.song.findUnique({ where: { id }, select: { artistId: true } }))?.artistId;

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
  return song;
}

export async function deleteSong(id: string) {
  await prisma.song.delete({ where: { id } });
}
