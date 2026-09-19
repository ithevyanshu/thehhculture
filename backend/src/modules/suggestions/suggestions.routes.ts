import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { SuggestionType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { parse } from '../../lib/http';
import { currentUser, requireAuth } from '../../middleware/auth';

/** "Feeling something is missing?" - signed-in users send ideas/corrections to the admins. */
export const suggestionsRouter = Router();
suggestionsRouter.use(requireAuth);

export const suggestionPublicSelect = {
  id: true,
  type: true,
  message: true,
  contextUrl: true,
  status: true,
  adminNote: true,
  createdAt: true,
  updatedAt: true,
} as const;

const perUserLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  // requireAuth runs first, so every request here has a user.
  keyGenerator: (req) => `user:${req.user?.id ?? 'unknown'}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: "You've sent a lot of suggestions this hour, thanks! Try again later." } },
});

const createSchema = z.object({
  type: z.nativeEnum(SuggestionType),
  message: z.string().trim().min(5, 'Tell us a bit more (at least 5 characters)').max(1000),
  // Only internal paths: the page the user was on.
  contextUrl: z
    .string()
    .trim()
    .max(300)
    .regex(/^\/[^\s]*$/, 'Must be a site path')
    .nullish()
    .transform((v) => v || null),
});

suggestionsRouter.post('/', perUserLimit, async (req, res) => {
  const input = parse(createSchema, req.body);
  const suggestion = await prisma.suggestion.create({
    data: { ...input, userId: currentUser(req).id },
    select: suggestionPublicSelect,
  });
  res.status(201).json({ suggestion });
});

/** The signed-in user's own suggestions, so they can see status + admin replies. */
suggestionsRouter.get('/mine', async (req, res) => {
  const items = await prisma.suggestion.findMany({
    where: { userId: currentUser(req).id },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: suggestionPublicSelect,
  });
  res.json({ items });
});
