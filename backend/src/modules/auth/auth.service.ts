import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { prisma } from '../../lib/prisma';
import { badRequest, conflict, forbidden, unauthorized } from '../../lib/http';
import { env } from '../../config/env';
import { generateRefreshToken, hashToken, signAccessToken } from './tokens';

const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 12);
const REUSE_GRACE_MS = 30_000;

export const publicUserSelect = {
  id: true,
  email: true,
  username: true,
  displayName: true,
  avatarUrl: true,
  bio: true,
  role: true,
  permissions: true,
  mustChangePassword: true,
  onboarded: true,
  createdAt: true,
  favoriteGenres: { select: { id: true, slug: true, name: true } },
  favoriteRegions: { select: { id: true, slug: true, name: true } },
} as const;

export async function getPublicUser(userId: string) {
  return prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
}

async function issueTokens(user: { id: string; role: import('@prisma/client').Role }, userAgent?: string) {
  const accessToken = signAccessToken({ sub: user.id, role: user.role });
  const { token: refreshToken, hash } = generateRefreshToken();
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { tokenHash: hash, userId: user.id, expiresAt, userAgent: userAgent?.slice(0, 255) },
  });
  return { accessToken, refreshToken, refreshExpiresAt: expiresAt };
}

export async function register(
  input: { email: string; username: string; password: string; displayName?: string },
  userAgent?: string,
) {
  const email = input.email.toLowerCase();
  const username = input.username.toLowerCase();

  const existing = await prisma.user.findFirst({
    where: { OR: [{ email }, { username }] },
    select: { email: true },
  });
  if (existing) {
    throw conflict(existing.email === email ? 'Email is already registered' : 'Username is taken');
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = await prisma.user.create({
    data: { email, username, passwordHash, displayName: input.displayName?.trim() || input.username },
    select: { id: true, role: true },
  });

  const tokens = await issueTokens(user, userAgent);
  return { user: (await getPublicUser(user.id))!, ...tokens };
}

export async function login(input: { identifier: string; password: string }, userAgent?: string) {
  const identifier = input.identifier.toLowerCase();
  const user = await prisma.user.findFirst({
    where: { OR: [{ email: identifier }, { username: identifier }] },
    select: { id: true, role: true, passwordHash: true, disabled: true },
  });

  // Compare against a dummy hash when the user doesn't exist to keep timing uniform.
  const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !user.passwordHash || !ok) throw unauthorized('Invalid credentials');
  if (user.disabled) throw forbidden('This account has been disabled');

  const tokens = await issueTokens(user, userAgent);
  return { user: (await getPublicUser(user.id))!, ...tokens };
}

/** Rotates a refresh token. Reuse of a revoked token revokes every session for that user. */
export async function refresh(rawToken: string, userAgent?: string) {
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: { select: { id: true, role: true, disabled: true } } },
  });
  if (!record) throw unauthorized('Invalid refresh token');

  if (record.revokedAt) {
    // A just-rotated token is usually benign: two tabs refreshing at once, or a
    // refresh response lost to a page reload/navigation before the browser stored the
    // new cookie. Within the grace window, issue a fresh session instead of failing;
    // older reuse is treated as theft and revokes every session.
    if (Date.now() - record.revokedAt.getTime() < REUSE_GRACE_MS) {
      if (record.user.disabled) throw forbidden('This account has been disabled');
      if (record.expiresAt < new Date()) throw unauthorized('Refresh token expired');
      const tokens = await issueTokens(record.user, userAgent);
      return { user: (await getPublicUser(record.userId))!, ...tokens };
    }
    await prisma.refreshToken.updateMany({
      where: { userId: record.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    throw unauthorized('Refresh token reuse detected; please sign in again');
  }
  if (record.expiresAt < new Date()) throw unauthorized('Refresh token expired');
  if (record.user.disabled) throw forbidden('This account has been disabled');

  await prisma.refreshToken.update({ where: { id: record.id }, data: { revokedAt: new Date() } });
  const tokens = await issueTokens(record.user, userAgent);
  return { user: (await getPublicUser(record.userId))!, ...tokens };
}

export async function logout(rawToken: string | undefined) {
  if (!rawToken) return;
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export const passwordRule = { min: 8, max: 128 } as const;

/** Signed-in password change; also clears the "must change" flag left by an admin reset. */
export async function changePassword(userId: string, currentPassword: string, newPassword: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user?.passwordHash || !(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw unauthorized('Current password is incorrect');
  }
  if (currentPassword === newPassword) throw badRequest('Pick a password different from the current one');
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash: await bcrypt.hash(newPassword, 12), mustChangePassword: false },
  });
  return (await getPublicUser(userId))!;
}

/**
 * Admin reset: a random temporary password (shown once to the admin), every session
 * signed out, and a new password required at the next sign-in.
 */
export async function resetPassword(userId: string) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/l/I lookalikes
  const bytes = randomBytes(12);
  const temporaryPassword = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(temporaryPassword, 12), mustChangePassword: true },
    }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
  ]);
  return temporaryPassword;
}
