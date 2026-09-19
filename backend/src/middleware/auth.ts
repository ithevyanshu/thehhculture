import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@prisma/client';
import { verifyAccessToken } from '../modules/auth/tokens';
import { forbidden, unauthorized } from '../lib/http';

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

/** Rejects with 401 unless a valid access token is present. */
export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = readBearer(req);
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) return next(unauthorized());
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
