import rateLimit from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Text search runs case-insensitive scans across the catalog, so it is the cheapest
 * endpoint to hammer and the most expensive to serve.
 *
 * The allowance is sized for type-ahead — the pickers fire on every keystroke — rather
 * than for scripted traffic, and it only counts requests that actually search: browsing
 * and paging through lists is never held up.
 */
export const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { message: 'Slow down a moment, then search again' } },
});

/** The same allowance for list endpoints, applied only when a query is being matched. */
export const querySearchLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 90,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: (req: Request) => !String(req.query.q ?? '').trim(),
  message: { error: { message: 'Slow down a moment, then search again' } },
});
