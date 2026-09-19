import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { env } from '../../config/env';
import { notFound, parse } from '../../lib/http';
import { currentUser, requireAuth } from '../../middleware/auth';
import * as auth from './auth.service';

const REFRESH_COOKIE = 'dhh_refresh';
const COOKIE_PATH = '/api/v1/auth';

/**
 * Browsers get the refresh token as an httpOnly cookie.
 * Non-browser clients (mobile, scripts, other services) send `X-Auth-Mode: token`
 * to receive it in the JSON body and pass it back in `{ refreshToken }`.
 */
const wantsTokenMode = (req: Request) => req.get('x-auth-mode')?.toLowerCase() === 'token';

function sendSession(req: Request, res: Response, session: Awaited<ReturnType<typeof auth.login>>, status = 200) {
  const { user, accessToken, refreshToken, refreshExpiresAt } = session;
  if (wantsTokenMode(req)) {
    return res.status(status).json({ user, accessToken, refreshToken, refreshExpiresAt });
  }
  res.cookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SECURE ? 'none' : 'lax',
    path: COOKIE_PATH,
    expires: refreshExpiresAt,
  });
  return res.status(status).json({ user, accessToken });
}

function readRefreshToken(req: Request): string | undefined {
  const fromBody = typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
  return fromBody ?? req.cookies?.[REFRESH_COOKIE];
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Too many attempts, please try again later' } },
});

const registerSchema = z.object({
  email: z.string().trim().email(),
  username: z
    .string()
    .trim()
    .min(3)
    .max(24)
    .regex(/^[a-zA-Z0-9_.]+$/, 'Only letters, numbers, underscores and dots'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  displayName: z.string().trim().max(50).optional(),
});

const loginSchema = z.object({
  identifier: z.string().trim().min(1, 'Email or username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const authRouter = Router();

authRouter.post('/register', authLimiter, async (req, res) => {
  const input = parse(registerSchema, req.body);
  sendSession(req, res, await auth.register(input, req.get('user-agent')), 201);
});

authRouter.post('/login', authLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body);
  sendSession(req, res, await auth.login(input, req.get('user-agent')));
});

authRouter.post('/refresh', async (req, res) => {
  const token = readRefreshToken(req);
  if (!token) return res.status(401).json({ error: { message: 'No refresh token' } });
  // On failure the cookie is left alone: another tab may have just rotated it.
  sendSession(req, res, await auth.refresh(token, req.get('user-agent')));
});

authRouter.post('/logout', async (req, res) => {
  await auth.logout(readRefreshToken(req));
  res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  res.status(204).end();
});

authRouter.get('/me', requireAuth, async (req, res) => {
  const user = await auth.getPublicUser(currentUser(req).id);
  if (!user) throw notFound('User');
  res.json({ user });
});
