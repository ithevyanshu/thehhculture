import { Router, json, raw } from 'express';
import { z } from 'zod';
import { badRequest, param, parse } from '../../lib/http';
import { currentUser } from '../../middleware/auth';
import { SHEETS, type SheetKind } from '../import/sheet.columns';
import { apply, preview, template, undoSheet } from '../import/sheet.service';

/** Spreadsheet upload: template, preview, apply, undo. Mounted under /admin. */
export const sheetsAdminRouter = Router();

const kindSchema = z.enum(['songs', 'albums', 'artists']);
const MAX_BYTES = 8 * 1024 * 1024;

/** What the columns mean, so the panel can show the same help as the template. */
sheetsAdminRouter.get('/sheets', (_req, res) => {
  res.json({
    kinds: (Object.keys(SHEETS) as SheetKind[]).map((k) => ({
      kind: k,
      label: SHEETS[k].label,
      note: SHEETS[k].note,
      columns: SHEETS[k].columns.map((c) => ({ header: c.header, hint: c.hint, required: !!c.required, key: !!c.key })),
    })),
  });
});

sheetsAdminRouter.get('/sheets/template/:kind', async (req, res) => {
  const kind = parse(kindSchema, param(req, 'kind'));
  const file = await template(kind);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="dhhculture-${kind}-template.xlsx"`);
  res.send(file);
});

/** The file arrives as a raw body so no upload middleware is needed. */
const upload = raw({ type: ['application/octet-stream', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv'], limit: MAX_BYTES });

const uploadQuery = z.object({ kind: kindSchema, filename: z.string().trim().min(1).max(200) });

sheetsAdminRouter.post('/sheets/preview', upload, async (req, res) => {
  const { kind, filename } = parse(uploadQuery, req.query);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('No file received');
  res.json(await preview(req.body, filename, kind));
});

sheetsAdminRouter.post('/sheets/apply', upload, async (req, res) => {
  const { kind, filename } = parse(uploadQuery, req.query);
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('No file received');
  res.status(201).json({ batch: await apply(req.body, filename, kind, currentUser(req).id) });
});

sheetsAdminRouter.post('/sheets/batches/:id/undo', json(), async (req, res) => {
  res.json(await undoSheet(param(req, 'id'), currentUser(req).id));
});
