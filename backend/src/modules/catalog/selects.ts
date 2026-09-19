import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

/** Shared projections so every endpoint returns the same card shapes. */

export const artistCardSelect = {
  id: true,
  slug: true,
  name: true,
  handle: true,
  imageUrl: true,
  verified: true,
  isProducer: true,
  instagramUrl: true,
  region: { select: { slug: true, name: true } },
  genres: { select: { slug: true, name: true } },
  _count: { select: { followers: true, songs: true } },
} satisfies Prisma.ArtistSelect;

export const songCardSelect = {
  id: true,
  slug: true,
  title: true,
  coverUrl: true,
  releaseDate: true,
  durationSec: true,
  explicit: true,
  spotifyTrackId: true,
  youtubeVideoId: true,
  artist: { select: { id: true, slug: true, name: true, handle: true, imageUrl: true } },
  features: { select: { artist: { select: { id: true, slug: true, name: true, handle: true } } } },
  producers: { select: { artist: { select: { id: true, slug: true, name: true, handle: true } } } },
  album: { select: { id: true, slug: true, title: true, coverUrl: true } },
  genres: { select: { slug: true, name: true } },
  _count: { select: { likes: true } },
} satisfies Prisma.SongSelect;

export const albumCardSelect = {
  id: true,
  slug: true,
  title: true,
  type: true,
  releaseDate: true,
  coverUrl: true,
  artist: { select: { id: true, slug: true, name: true } },
  _count: { select: { songs: true } },
} satisfies Prisma.AlbumSelect;

export type ArtistCard = Prisma.ArtistGetPayload<{ select: typeof artistCardSelect }>;
export type SongCard = Prisma.SongGetPayload<{ select: typeof songCardSelect }>;

/** Adds `isFollowing` for the current user (false for anonymous requests). */
export async function withFollowFlags<T extends { id: string }>(userId: string | undefined, artists: T[]) {
  if (!userId || artists.length === 0) return artists.map((a) => ({ ...a, isFollowing: false }));
  const rows = await prisma.follow.findMany({
    where: { userId, artistId: { in: artists.map((a) => a.id) } },
    select: { artistId: true },
  });
  const set = new Set(rows.map((r) => r.artistId));
  return artists.map((a) => ({ ...a, isFollowing: set.has(a.id) }));
}

/** Adds `isLiked` for the current user (false for anonymous requests). */
export async function withLikeFlags<T extends { id: string }>(userId: string | undefined, songs: T[]) {
  if (!userId || songs.length === 0) return songs.map((s) => ({ ...s, isLiked: false }));
  const rows = await prisma.songLike.findMany({
    where: { userId, songId: { in: songs.map((s) => s.id) } },
    select: { songId: true },
  });
  const set = new Set(rows.map((r) => r.songId));
  return songs.map((s) => ({ ...s, isLiked: set.has(s.id) }));
}

/** Best-effort "recently viewed" tracking; failures never break the request. */
export async function recordView(userId: string | undefined, target: { artistId: string } | { songId: string }) {
  if (!userId) return;
  try {
    if ('artistId' in target) {
      await prisma.recentView.upsert({
        where: { userId_artistId: { userId, artistId: target.artistId } },
        create: { userId, artistId: target.artistId },
        update: { viewedAt: new Date() },
      });
    } else {
      await prisma.recentView.upsert({
        where: { userId_songId: { userId, songId: target.songId } },
        create: { userId, songId: target.songId },
        update: { viewedAt: new Date() },
      });
    }
  } catch (err) {
    console.warn('recordView failed', err);
  }
}
