import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../modules/auth/tokens';
import { forbidden, unauthorized } from '../lib/http';
import { prisma } from '../lib/prisma';
import { subAdminCan } from '../lib/permissions';

function readBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

/** Attaches req.user when a valid access token is present; never rejects. */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearer(req);
  if (token) {
    const payload = verifyAccessToken(token);
    if (payload) req.user = { id: payload.sub, role: payload.role };
  }
  next();
}

/**
 * Rejects with 401 unless a valid access token is present and the account is still active.
 *
 * Disabling a user revokes their refresh tokens, but the access token they already hold
 * stays valid for its remaining minutes, so the account is checked here too — one
 * primary-key lookup on routes that already hit the database.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearer(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return next(unauthorized());
  const account = await prisma.user.findUnique({ where: { id: payload.sub }, select: { disabled: true } });
  if (!account) return next(unauthorized());
  if (account.disabled) return next(forbidden('This account has been disabled'));
  req.user = { id: payload.sub, role: payload.role };
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden('Insufficient permissions'));
    next();
  };
}

/** Narrowing helper for handlers mounted behind requireAuth. */
export function currentUser(req: Request) {
  if (!req.user) throw unauthorized();
  return req.user;
}

/**
 * Admin area gate. Full admins pass; sub-admins pass only for routes their permissions
 * open (see lib/permissions). Role and permissions are read from the DB on every request,
 * so a change by an admin applies immediately rather than when the access token expires.
 */
export async function requireStaff(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { role: true, permissions: true, disabled: true } });
  if (!user || user.disabled) return next(unauthorized());
  if (user.role !== 'ADMIN' && !(user.role === 'SUB_ADMIN' && subAdminCan(user.permissions, req.method, req.path))) {
    return next(forbidden("You don't have access to this part of the admin panel"));
  }
  req.staff = { role: user.role, permissions: user.permissions };
  next();
}
