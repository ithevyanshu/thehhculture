import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { forbidden, notFound, pageMeta, paginate, paginationSchema, param, parse, unauthorized } from '../../lib/http';
import { requireAuth } from '../../middleware/auth';
import { albumCardSelect, songCardSelect } from '../catalog/selects';
import { getSiteConfig } from '../site/config';
import { changeSelect, postSchema, studioAlbumSchema, studioProfileSchema, studioSongSchema, submitChange, verify } from './studio.service';

/** The Artist Studio API: everything is scoped to the caller's own artist profile. */
export const studioRouter = Router();

/** Resolves the artist this account manages (linked by an admin), or 403. */
async function requireManagedArtist(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  const artist = await prisma.artist.findUnique({ where: { managedById: req.user.id }, select: { id: true } });
  if (!artist) return next(forbidden('This account is not linked to an artist profile'));
  req.studioArtistId = artist.id;
  next();
}
const artistIdOf = (req: Request) => req.studioArtistId!;

studioRouter.use(requireAuth, requireManagedArtist);

const submit = (req: Request, action: Parameters<typeof submitChange>[0]['action'], payload: Record<string, unknown>, targetId?: string) =>
  submitChange({ artistId: artistIdOf(req), authorId: req.user!.id, action, targetId, payload });

// ---------- Overview ----------

studioRouter.get('/', async (req, res) => {
  const artistId = artistIdOf(req);
  const [artist, pending, { studio }] = await Promise.all([
    prisma.artist.findUnique({
      where: { id: artistId },
      include: { genres: { select: { slug: true, name: true } }, region: { select: { slug: true, name: true } } },
    }),
    prisma.artistChange.count({ where: { artistId, status: 'PENDING' } }),
    getSiteConfig(),
  ]);
  res.json({ artist, pending, autoPublish: studio.autoPublish });
});

studioRouter.get('/stats', async (req, res) => {
  const artistId = artistIdOf(req);
  const day = 86_400_000;
  const since30 = new Date(Date.now() - 30 * day);
  const [artist, followers, followers7, followers30, views, songs] = await Promise.all([
    prisma.artist.findUnique({ where: { id: artistId }, select: { viewCount: true } }),
    prisma.follow.count({ where: { artistId } }),
    prisma.follow.count({ where: { artistId, createdAt: { gte: new Date(Date.now() - 7 * day) } } }),
    prisma.follow.count({ where: { artistId, createdAt: { gte: since30 } } }),
    prisma.artistDailyView.findMany({ where: { artistId, day: { gte: since30 } }, orderBy: { day: 'asc' }, select: { day: true, count: true } }),
    prisma.song.findMany({
      where: { artistId },
      orderBy: { likes: { _count: 'desc' } },
      select: { id: true, slug: true, title: true, releaseDate: true, _count: { select: { likes: true, playlistEntries: true } } },
    }),
  ]);
  const weekAgo = Date.now() - 7 * day;
  res.json({
    followers: { total: followers, last7: followers7, last30: followers30 },
    views: {
      allTime: artist?.viewCount ?? 0,
      week: views.filter((v) => v.day.getTime() >= weekAgo).reduce((n, v) => n + v.count, 0),
      daily: views.map((v) => ({ day: v.day.toISOString().slice(0, 10), count: v.count })),
    },
    likes: songs.reduce((n, s) => n + s._count.likes, 0),
    songs: songs.map((s) => ({ id: s.id, slug: s.slug, title: s.title, releaseDate: s.releaseDate, likes: s._count.likes, playlists: s._count.playlistEntries })),
  });
});

// ---------- Profile ----------

studioRouter.patch('/profile', async (req, res) => {
  res.json(await submit(req, 'PROFILE_UPDATE', parse(studioProfileSchema, req.body)));
});

// ---------- Albums ----------

studioRouter.get('/albums', async (req, res) => {
  const items = await prisma.album.findMany({
    where: { artistId: artistIdOf(req) },
    orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
    select: albumCardSelect,
  });
  res.json({ items });
});

studioRouter.get('/albums/:id', async (req, res) => {
  const album = await prisma.album.findUnique({ where: { id: param(req, 'id') } });
  if (!album || album.artistId !== artistIdOf(req)) throw notFound('Album');
  res.json({ album });
});

studioRouter.post('/albums', async (req, res) => {
  res.status(201).json(await submit(req, 'ALBUM_CREATE', parse(studioAlbumSchema, req.body)));
});

studioRouter.patch('/albums/:id', async (req, res) => {
  const id = param(req, 'id');
  await verify.ownAlbum(artistIdOf(req), id);
  res.json(await submit(req, 'ALBUM_UPDATE', parse(studioAlbumSchema.partial(), req.body), id));
});

studioRouter.delete('/albums/:id', async (req, res) => {
  const id = param(req, 'id');
  await verify.ownAlbum(artistIdOf(req), id);
  res.json(await submit(req, 'ALBUM_DELETE', {}, id));
});

// ---------- Songs (the artist's own releases; features on others' songs are read-only) ----------

studioRouter.get('/songs', async (req, res) => {
  const items = await prisma.song.findMany({
    where: { artistId: artistIdOf(req) },
    orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
    select: songCardSelect,
  });
  res.json({ items });
});

studioRouter.get('/songs/:id', async (req, res) => {
  const song = await prisma.song.findUnique({
    where: { id: param(req, 'id') },
    include: {
      genres: { select: { slug: true } },
      features: { select: { artist: { select: { id: true, slug: true, name: true, handle: true } } } },
      producers: { select: { artist: { select: { id: true, slug: true, name: true, handle: true } } } },
    },
  });
  if (!song || song.artistId !== artistIdOf(req)) throw notFound('Song');
  res.json({ song });
});

studioRouter.post('/songs', async (req, res) => {
  const input = parse(studioSongSchema, req.body);
  await verify.checkSongRefs(artistIdOf(req), input);
  res.status(201).json(await submit(req, 'SONG_CREATE', input));
});

studioRouter.patch('/songs/:id', async (req, res) => {
  const id = param(req, 'id');
  await verify.ownSong(artistIdOf(req), id);
  const input = parse(studioSongSchema.partial(), req.body);
  await verify.checkSongRefs(artistIdOf(req), input);
  res.json(await submit(req, 'SONG_UPDATE', input, id));
});

studioRouter.delete('/songs/:id', async (req, res) => {
  const id = param(req, 'id');
  await verify.ownSong(artistIdOf(req), id);
  res.json(await submit(req, 'SONG_DELETE', {}, id));
});

// ---------- Posts ----------

studioRouter.get('/posts', async (req, res) => {
  const items = await prisma.artistPost.findMany({ where: { artistId: artistIdOf(req) }, orderBy: { createdAt: 'desc' }, take: 50 });
  res.json({ items });
});

studioRouter.post('/posts', async (req, res) => {
  res.status(201).json(await submit(req, 'POST_CREATE', parse(postSchema, req.body)));
});

/** Taking a post down never needs approval. */
studioRouter.delete('/posts/:id', async (req, res) => {
  const { count } = await prisma.artistPost.deleteMany({ where: { id: param(req, 'id'), artistId: artistIdOf(req) } });
  if (!count) throw notFound('Post');
  res.status(204).end();
});

// ---------- Activity ----------

studioRouter.get('/changes', async (req, res) => {
  const { page, limit, status } = parse(paginationSchema.extend({ status: z.enum(['PENDING', 'APPLIED', 'REJECTED']).optional() }), req.query);
  const where = { artistId: artistIdOf(req), ...(status && { status }) };
  const [items, total] = await Promise.all([
    prisma.artistChange.findMany({ where, orderBy: { createdAt: 'desc' }, select: changeSelect, ...paginate(page, limit) }),
    prisma.artistChange.count({ where }),
  ]);
  res.json({ items, meta: pageMeta(page, limit, total) });
});

/** Withdraw a change that hasn't been reviewed yet. */
studioRouter.delete('/changes/:id', async (req, res) => {
  const { count } = await prisma.artistChange.deleteMany({ where: { id: param(req, 'id'), artistId: artistIdOf(req), status: 'PENDING' } });
  if (!count) throw notFound('Pending change');
  res.status(204).end();
});
