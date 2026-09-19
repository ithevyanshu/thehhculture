import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { forbidden, notFound, parse, param } from '../../lib/http';
import { currentUser, optionalAuth, requireAuth } from '../../middleware/auth';
import { songCardSelect, withLikeFlags } from '../catalog/selects';

export const playlistsRouter = Router();

export const playlistCardSelect = {
  id: true,
  name: true,
  description: true,
  isPublic: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, username: true, displayName: true } },
  _count: { select: { songs: true } },
  // First few covers for a mosaic thumbnail
  songs: {
    take: 4,
    orderBy: { position: 'asc' as const },
    select: { song: { select: { coverUrl: true, album: { select: { coverUrl: true } } } } },
  },
};

const playlistSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  isPublic: z.boolean().optional(),
});

async function ownedPlaylist(id: string, userId: string) {
  const playlist = await prisma.playlist.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!playlist) throw notFound('Playlist');
  if (playlist.userId !== userId) throw forbidden('You do not own this playlist');
  return playlist;
}

playlistsRouter.get('/mine', requireAuth, async (req, res) => {
  const items = await prisma.playlist.findMany({
    where: { userId: currentUser(req).id },
    orderBy: { updatedAt: 'desc' },
    select: playlistCardSelect,
  });
  res.json({ items });
});

playlistsRouter.post('/', requireAuth, async (req, res) => {
  const input = parse(playlistSchema, req.body);
  const playlist = await prisma.playlist.create({
    data: { ...input, userId: currentUser(req).id },
    select: playlistCardSelect,
  });
  res.status(201).json({ playlist });
});

playlistsRouter.get('/:id', optionalAuth, async (req, res) => {
  const playlist = await prisma.playlist.findUnique({
    where: { id: param(req, 'id') },
    select: {
      ...playlistCardSelect,
      songs: { orderBy: { position: 'asc' }, select: { addedAt: true, position: true, song: { select: songCardSelect } } },
    },
  });
  if (!playlist) throw notFound('Playlist');
  const isOwner = req.user?.id === playlist.user.id;
  if (!playlist.isPublic && !isOwner) throw notFound('Playlist');

  const songs = await withLikeFlags(req.user?.id, playlist.songs.map((s) => s.song));
  res.json({ playlist: { ...playlist, songs, isOwner } });
});

playlistsRouter.patch('/:id', requireAuth, async (req, res) => {
  await ownedPlaylist(param(req, 'id'), currentUser(req).id);
  const input = parse(playlistSchema.partial(), req.body);
  const playlist = await prisma.playlist.update({ where: { id: param(req, 'id') }, data: input, select: playlistCardSelect });
  res.json({ playlist });
});

playlistsRouter.delete('/:id', requireAuth, async (req, res) => {
  await ownedPlaylist(param(req, 'id'), currentUser(req).id);
  await prisma.playlist.delete({ where: { id: param(req, 'id') } });
  res.status(204).end();
});

playlistsRouter.post('/:id/songs', requireAuth, async (req, res) => {
  const playlist = await ownedPlaylist(param(req, 'id'), currentUser(req).id);
  const { songId } = parse(z.object({ songId: z.string().min(1) }), req.body);

  const song = await prisma.song.findUnique({ where: { id: songId }, select: { id: true } });
  if (!song) throw notFound('Song');

  const last = await prisma.playlistSong.aggregate({ where: { playlistId: playlist.id }, _max: { position: true } });
  await prisma.$transaction([
    prisma.playlistSong.upsert({
      where: { playlistId_songId: { playlistId: playlist.id, songId } },
      create: { playlistId: playlist.id, songId, position: (last._max.position ?? -1) + 1 },
      update: {},
    }),
    prisma.playlist.update({ where: { id: playlist.id }, data: { updatedAt: new Date() } }),
  ]);
  res.status(201).json({ ok: true });
});

playlistsRouter.delete('/:id/songs/:songId', requireAuth, async (req, res) => {
  const playlist = await ownedPlaylist(param(req, 'id'), currentUser(req).id);
  await prisma.playlistSong.deleteMany({ where: { playlistId: playlist.id, songId: param(req, 'songId') } });
  res.status(204).end();
});
