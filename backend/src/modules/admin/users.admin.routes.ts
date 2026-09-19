import { Router } from 'express';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, notFound, pageMeta, paginate, paginationSchema, param, parse } from '../../lib/http';
import { currentUser } from '../../middleware/auth';

/** User management. Mounted under /admin (already admin-only). */
export const usersAdminRouter = Router();

const userAdminSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  disabled: true,
  onboarded: true,
  createdAt: true,
  _count: { select: { follows: true, likes: true, playlists: true } },
} satisfies Prisma.UserSelect;

usersAdminRouter.get('/users', async (req, res) => {
  const { page, limit, q, role, status } = parse(
    paginationSchema.extend({
      q: z.string().trim().optional(),
      role: z.nativeEnum(Role).optional(),
      status: z.enum(['active', 'disabled']).optional(),
    }),
    req.query,
  );
  const where: Prisma.UserWhereInput = {
    ...(q && {
      OR: [
        { email: { contains: q, mode: 'insensitive' } },
        { username: { contains: q, mode: 'insensitive' } },
        { displayName: { contains: q, mode: 'insensitive' } },
      ],
    }),
    ...(role && { role }),
    ...(status && { disabled: status === 'disabled' }),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({ where, orderBy: { createdAt: 'desc' }, select: userAdminSelect, ...paginate(page, limit) }),
    prisma.user.count({ where }),
  ]);
  res.json({ items, meta: pageMeta(page, limit, total) });
});

usersAdminRouter.patch('/users/:id', async (req, res) => {
  const id = param(req, 'id');
  const me = currentUser(req);
  const input = parse(
    z.object({
      // ARTIST stays reserved until artist accounts ship (see docs/ROADMAP.md).
      role: z.enum([Role.USER, Role.ADMIN]).optional(),
      disabled: z.boolean().optional(),
    }),
    req.body,
  );
  if (id === me.id && (input.role === Role.USER || input.disabled)) {
    throw badRequest("You can't demote or disable your own account");
  }

  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw notFound('User');

  // Never leave the site without an active admin.
  if (target.role === Role.ADMIN && (input.role === Role.USER || input.disabled)) {
    const otherAdmins = await prisma.user.count({ where: { role: Role.ADMIN, disabled: false, id: { not: id } } });
    if (otherAdmins === 0) throw badRequest('This is the last active admin');
  }

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id }, data: input, select: userAdminSelect });
    // Disabling or changing role signs the user out everywhere (role lives in the access token).
    if (input.disabled || input.role) {
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return updated;
  });
  res.json({ user });
});
