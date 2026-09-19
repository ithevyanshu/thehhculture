import { Router } from 'express';
import { Prisma, SuggestionStatus, SuggestionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { pageMeta, paginate, paginationSchema, param, parse } from '../../lib/http';

/** Suggestion inbox. Mounted under /admin (already admin-only). */
export const suggestionsAdminRouter = Router();

const adminSelect = {
  id: true,
  type: true,
  message: true,
  contextUrl: true,
  status: true,
  adminNote: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { id: true, username: true, displayName: true, email: true } },
} satisfies Prisma.SuggestionSelect;

suggestionsAdminRouter.get('/suggestions', async (req, res) => {
  const { page, limit, status, type, q } = parse(
    paginationSchema.extend({
      status: z.nativeEnum(SuggestionStatus).optional(),
      type: z.nativeEnum(SuggestionType).optional(),
      q: z.string().trim().optional(),
    }),
    req.query,
  );
  const where: Prisma.SuggestionWhereInput = {
    ...(status && { status }),
    ...(type && { type }),
    ...(q && { message: { contains: q, mode: 'insensitive' } }),
  };
  const [items, total, byStatus] = await Promise.all([
    prisma.suggestion.findMany({ where, orderBy: { createdAt: 'desc' }, select: adminSelect, ...paginate(page, limit) }),
    prisma.suggestion.count({ where }),
    prisma.suggestion.groupBy({ by: ['status'], _count: { _all: true } }),
  ]);
  res.json({
    items,
    meta: pageMeta(page, limit, total),
    counts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
  });
});

suggestionsAdminRouter.patch('/suggestions/:id', async (req, res) => {
  const input = parse(
    z.object({
      status: z.nativeEnum(SuggestionStatus).optional(),
      adminNote: z
        .string()
        .trim()
        .max(500)
        .nullish()
        .transform((v) => (v === undefined ? undefined : v || null)),
    }),
    req.body,
  );
  const suggestion = await prisma.suggestion.update({ where: { id: param(req, 'id') }, data: input, select: adminSelect });
  res.json({ suggestion });
});

suggestionsAdminRouter.delete('/suggestions/:id', async (req, res) => {
  await prisma.suggestion.delete({ where: { id: param(req, 'id') } });
  res.status(204).end();
});
