import type { Role } from '@prisma/client';

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; role: Role };
      /** Set on /admin routes: the caller's current role and permissions, read fresh from the DB. */
      staff?: { role: Role; permissions: string[] };
    }
  }
}

export {};
