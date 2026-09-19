import { Router, type Request } from 'express';
import { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, forbidden, notFound, pageMeta, paginate, paginationSchema, param, parse } from '../../lib/http';
import { PERMISSIONS } from '../../lib/permissions';
import { resetPassword } from '../auth/auth.service';
import { currentUser } from '../../middleware/auth';

/** User management. Mounted under /admin (full admins, or sub-admins with "users"). */
export const usersAdminRouter = Router();

const userAdminSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  disabled: true,
  permissions: true,
  mustChangePassword: true,
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

/** Sub-admins with "users" access may only act on regular users; staff is managed by full admins. */
async function loadTarget(req: Request, id: string) {
  const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!target) throw notFound('User');
  if (req.staff?.role !== Role.ADMIN && target.role !== Role.USER) {
    throw forbidden('Only full admins can manage admins and sub-admins');
  }
  return target;
}

usersAdminRouter.patch('/users/:id', async (req, res) => {
  const id = param(req, 'id');
  const me = currentUser(req);
  const isAdmin = req.staff?.role === Role.ADMIN;
  const input = parse(
    z.object({
      // ARTIST stays reserved until artist accounts ship (see docs/ROADMAP.md).
      role: z.enum([Role.USER, Role.SUB_ADMIN, Role.ADMIN]).optional(),
      permissions: z.array(z.enum(PERMISSIONS)).optional(),
      disabled: z.boolean().optional(),
    }),
    req.body,
  );
  if (!isAdmin && (input.role || input.permissions)) throw forbidden('Only full admins can change roles and permissions');
  if (id === me.id && ((input.role && input.role !== Role.ADMIN) || input.disabled)) {
    throw badRequest("You can't demote or disable your own account");
  }

  const target = await loadTarget(req, id);

  // Never leave the site without an active admin.
  if (target.role === Role.ADMIN && ((input.role && input.role !== Role.ADMIN) || input.disabled)) {
    const otherAdmins = await prisma.user.count({ where: { role: Role.ADMIN, disabled: false, id: { not: id } } });
    if (otherAdmins === 0) throw badRequest('This is the last active admin');
  }

  // Permissions only mean something for sub-admins; leaving the role clears them.
  const role = input.role ?? target.role;
  const data = {
    ...input,
    ...(role !== Role.SUB_ADMIN ? { permissions: [] } : input.permissions && { permissions: [...new Set(input.permissions)] }),
  };

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id }, data, select: userAdminSelect });
    // Disabling or changing role signs the user out everywhere (role lives in the access token).
    // Permission changes need no sign-out: /admin reads them fresh on every request.
    if (input.disabled || (input.role && input.role !== target.role)) {
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    }
    return updated;
  });
  res.json({ user });
});

/** Temporary password, returned once for the admin to pass on. */
usersAdminRouter.post('/users/:id/reset-password', async (req, res) => {
  const id = param(req, 'id');
  if (id === currentUser(req).id) throw badRequest('Change your own password in Settings');
  await loadTarget(req, id);
  res.json({ temporaryPassword: await resetPassword(id) });
});
