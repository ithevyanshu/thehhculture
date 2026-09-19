import { createHash, randomBytes } from 'crypto';
import jwt, { type SignOptions } from 'jsonwebtoken';
import type { Role } from '@prisma/client';
import { env } from '../../config/env';

export interface AccessTokenPayload {
  sub: string;
  role: Role;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
    expiresIn: env.ACCESS_TOKEN_TTL as SignOptions['expiresIn'],
    issuer: 'dhh-api',
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET, { issuer: 'dhh-api' });
    if (typeof decoded === 'string' || !decoded.sub) return null;
    return { sub: decoded.sub, role: (decoded as jwt.JwtPayload).role as Role };
  } catch {
    return null;
  }
}

/** Refresh tokens are opaque random strings; only their SHA-256 hash is stored. */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
