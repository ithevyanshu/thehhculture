/**
 * Artist Studio: artists edit their own profile, releases and posts. Every change is
 * recorded as an ArtistChange; depending on the admin's auto-publish settings it goes
 * live at once (APPLIED) or waits for approval (PENDING) and is applied later from the
 * stored payload, through the same catalog editor the admin panel uses.
 */
import { ArtistChangeAction, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound } from '../../lib/http';
import {
  albumSchema,
  artistSchema,
  createAlbum,
  createSong,
  deleteAlbum,
  deleteSong,
  songSchema,
  updateAlbum,
  updateArtist,
  updateSong,
} from '../catalog/editor';
import { getSiteConfig } from '../site/config';

// ---------- What an artist may send ----------

/** Admin-only fields (verified, featured, slug, producer badge, Spotify ID, photo source) are left out. */
export const studioProfileSchema = artistSchema
  .pick({
    name: true,
    realName: true,
    bio: true,
    imageUrl: true,
    imageCredit: true,
    bannerUrl: true,
    activeSince: true,
    regionSlug: true,
    genreSlugs: true,
    instagramUrl: true,
    youtubeUrl: true,
    spotifyUrl: true,
    handle: true,
  })
  .partial();

/** The owning artist is implied; slugs are derived. */
export const studioAlbumSchema = albumSchema.omit({ artistId: true, slug: true });
export const studioSongSchema = songSchema.omit({ artistId: true, slug: true });

const postLink = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => !v || v.startsWith('/') || /^https?:\/\//i.test(v), 'Use a page here (/songs/…) or a full https:// link');
export const postSchema = z.object({
  text: z.string().trim().min(1, 'Write something').max(280),
  linkUrl: postLink,
});

// ---------- Auto-publish ----------

type Category = 'profile' | 'releases' | 'posts';
const CATEGORY: Record<ArtistChangeAction, Category> = {
  PROFILE_UPDATE: 'profile',
  ALBUM_CREATE: 'releases',
  ALBUM_UPDATE: 'releases',
  ALBUM_DELETE: 'releases',
  SONG_CREATE: 'releases',
  SONG_UPDATE: 'releases',
  SONG_DELETE: 'releases',
  POST_CREATE: 'posts',
};

// ---------- Ownership checks (run on submit and again on approval) ----------

async function ownAlbum(artistId: string, albumId: string) {
  const album = await prisma.album.findUnique({ where: { id: albumId }, select: { artistId: true, title: true } });
  if (!album || album.artistId !== artistId) throw notFound('Album');
  return album;
}

async function ownSong(artistId: string, songId: string) {
  const song = await prisma.song.findUnique({ where: { id: songId }, select: { artistId: true, title: true } });
  if (!song || song.artistId !== artistId) throw notFound('Song');
  return song;
}

/** Album must be the artist's own; credited artists and genres must exist. */
async function checkSongRefs(artistId: string, input: Partial<z.output<typeof studioSongSchema>>) {
  if (input.albumId) await ownAlbum(artistId, input.albumId);
  const ids = [...new Set([...(input.featureArtistIds ?? []), ...(input.producerArtistIds ?? [])])];
  if (ids.length && (await prisma.artist.count({ where: { id: { in: ids } } })) !== ids.length) {
    throw badRequest('Some credited artists no longer exist');
  }
  if (input.genreSlugs?.length && (await prisma.genre.count({ where: { slug: { in: input.genreSlugs } } })) !== input.genreSlugs.length) {
    throw badRequest('Unknown genre');
  }
}

// ---------- Apply ----------

/** Re-validates the stored payload and writes it. Used for auto-publish and approvals. */
export async function applyChange(change: { artistId: string; action: ArtistChangeAction; targetId: string | null; payload: unknown }) {
  const { artistId, action, targetId, payload } = change;
  const parse = <S extends z.ZodTypeAny>(schema: S) => {
    const r = schema.safeParse(payload);
    if (!r.success) throw badRequest(`This change is no longer valid: ${r.error.issues[0]?.message ?? 'bad data'}`);
    return r.data as z.output<S>;
  };

  switch (action) {
    case 'PROFILE_UPDATE':
      return updateArtist(artistId, parse(studioProfileSchema));
    case 'ALBUM_CREATE':
      return createAlbum({ ...parse(studioAlbumSchema), artistId, slug: undefined });
    case 'ALBUM_UPDATE':
      await ownAlbum(artistId, targetId!);
      return updateAlbum(targetId!, parse(studioAlbumSchema.partial()));
    case 'ALBUM_DELETE':
      await ownAlbum(artistId, targetId!);
      return deleteAlbum(targetId!);
    case 'SONG_CREATE': {
      const input = parse(studioSongSchema);
      await checkSongRefs(artistId, input);
      return createSong({ ...input, artistId, slug: undefined });
    }
    case 'SONG_UPDATE': {
      await ownSong(artistId, targetId!);
      const input = parse(studioSongSchema.partial());
      await checkSongRefs(artistId, input);
      return updateSong(targetId!, input);
    }
    case 'SONG_DELETE':
      await ownSong(artistId, targetId!);
      return deleteSong(targetId!);
    case 'POST_CREATE':
      return prisma.artistPost.create({ data: { artistId, ...parse(postSchema) } });
  }
}

// ---------- Submit ----------

/** Short label for lists: the item's title, or what changed. */
async function summarize(artistId: string, action: ArtistChangeAction, targetId: string | null, payload: Record<string, unknown>) {
  switch (action) {
    case 'PROFILE_UPDATE':
      return `Profile: ${Object.keys(payload).join(', ') || 'no fields'}`;
    case 'ALBUM_CREATE':
    case 'SONG_CREATE':
      return String(payload.title);
    case 'ALBUM_UPDATE':
    case 'ALBUM_DELETE':
      return (await ownAlbum(artistId, targetId!)).title;
    case 'SONG_UPDATE':
    case 'SONG_DELETE':
      return (await ownSong(artistId, targetId!)).title;
    case 'POST_CREATE':
      return String(payload.text).slice(0, 80);
  }
}

/**
 * Records a change and publishes it now if the admin allows that kind automatically.
 * `payload` must already be validated with the matching studio schema.
 */
export async function submitChange(input: {
  artistId: string;
  authorId: string;
  action: ArtistChangeAction;
  targetId?: string | null;
  payload: Record<string, unknown>;
}) {
  const { artistId, authorId, action } = input;
  const targetId = input.targetId ?? null;
  // Dates etc. become plain JSON, exactly what is stored and re-validated on approval.
  const payload = JSON.parse(JSON.stringify(input.payload)) as Prisma.InputJsonObject;
  const summary = (await summarize(artistId, action, targetId, input.payload)).slice(0, 200);

  const { studio } = await getSiteConfig();
  const auto = studio.autoPublish[CATEGORY[action]];
  if (auto) await applyChange({ artistId, action, targetId, payload });

  const change = await prisma.artistChange.create({
    data: { artistId, authorId, action, targetId, summary, payload, status: auto ? 'APPLIED' : 'PENDING', ...(auto && { reviewedAt: new Date() }) },
    select: changeSelect,
  });
  return { status: change.status, change };
}

export const changeSelect = {
  id: true,
  action: true,
  targetId: true,
  summary: true,
  payload: true,
  status: true,
  reviewNote: true,
  reviewedAt: true,
  createdAt: true,
} satisfies Prisma.ArtistChangeSelect;

/** Pre-submit checks that need the DB (ownership and references). */
export const verify = { ownAlbum, ownSong, checkSongRefs };
