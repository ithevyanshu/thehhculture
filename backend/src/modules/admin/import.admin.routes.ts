import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { notFound, pageMeta, paginate, paginationSchema, param, parse } from '../../lib/http';
import { currentUser } from '../../middleware/auth';
import { batchSelect, findCandidates, preview, run, searchTracks, undo, undoImpact } from '../import/import.service';
import { undoSheet } from '../import/sheet.service';

/** Catalog import from iTunes, and the one-click undo for each run. Mounted under /admin. */
export const importAdminRouter = Router();

/** iTunes ids are numeric but bigger than a 32-bit int, so they travel as strings. */
const itunesIdSchema = z.string().regex(/^\d+$/, 'Expected an iTunes id');

/** Which iTunes artist is ours? Same-name artists exist everywhere, so a human picks. */
importAdminRouter.get('/import/candidates', async (req, res) => {
  const { artistId } = parse(z.object({ artistId: z.string().min(1) }), req.query);
  res.json(await findCandidates(artistId));
});

/** Their releases, with the ones we already have marked so nothing is duplicated. */
importAdminRouter.get('/import/preview', async (req, res) => {
  const { artistId, itunesId } = parse(z.object({ artistId: z.string().min(1), itunesId: itunesIdSchema }), req.query);
  res.json(await preview(artistId, itunesId));
});

/** Search all of iTunes by song title, for releases the artist listing doesn't carry. */
importAdminRouter.get('/import/search', async (req, res) => {
  const { artistId, q } = parse(z.object({ artistId: z.string().min(1), q: z.string().trim().min(2).max(120) }), req.query);
  res.json(await searchTracks(artistId, q));
});

importAdminRouter.post('/import/run', async (req, res) => {
  const input = parse(
    z.object({
      artistId: z.string().min(1),
      // Absent when everything was picked from search rather than an artist's listing.
      itunesId: itunesIdSchema.nullish(),
      trackIds: z.array(itunesIdSchema).min(1).max(200),
    }),
    req.body,
  );
  res.status(201).json({ batch: await run({ ...input, userId: currentUser(req).id }) });
});

importAdminRouter.get('/import/batches', async (req, res) => {
  const { page, limit } = parse(paginationSchema, req.query);
  const [items, total] = await Promise.all([
    prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, select: batchSelect, ...paginate(page, limit) }),
    prisma.importBatch.count(),
  ]);
  res.json({ items, meta: pageMeta(page, limit, total) });
});

/** What undoing would delete right now, so the confirmation can spell it out. */
importAdminRouter.get('/import/batches/:id/impact', async (req, res) => {
  const { batch, songs, albums, likes, playlistEntries } = await undoImpact(param(req, 'id'));
  const artists = batch.artistIds.length ? await prisma.artist.findMany({ where: { id: { in: batch.artistIds } }, select: { name: true } }) : [];
  res.json({
    batch: { id: batch.id, source: batch.source, label: batch.label, artistName: batch.artistName, undoneAt: batch.undoneAt },
    songs: songs.map((s) => s.title),
    albums: albums.map((a) => a.title),
    artists: artists.map((a) => a.name),
    /** Spreadsheet uploads: rows whose previous values would be put back. */
    restores: ((batch.updates ?? []) as unknown[]).length,
    likes,
    playlistEntries,
  });
});

importAdminRouter.post('/import/batches/:id/undo', async (req, res) => {
  const id = param(req, 'id');
  const batch = await prisma.importBatch.findUnique({ where: { id }, select: { source: true } });
  if (!batch) throw notFound('Import');
  // Spreadsheet uploads also changed existing rows, so their undo restores the old values.
  res.json(batch.source === 'SHEET' ? await undoSheet(id, currentUser(req).id) : await undo(id, currentUser(req).id));
});
