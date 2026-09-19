/**
 * Artist click tracking + trending ranking.
 *
 * A "click" is a profile open. The same visitor (user id, or IP when signed out) is
 * counted at most once per artist every 30 minutes so refreshing can't inflate ranks.
 * The de-dupe window lives in memory: fine for one API instance; with several
 * instances move it to Redis (SET key NX EX 1800).
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { artistCardSelect, withFollowFlags } from './selects';

const DEDUPE_MS = 30 * 60 * 1000;
export const TRENDING_DAYS = 7;

const seen = new Map<string, number>(); // "visitor:artist" -> expiry timestamp

// Drop expired entries so the map can't grow without bound.
setInterval(() => {
  const now = Date.now();
  for (const [key, expires] of seen) if (expires <= now) seen.delete(key);
}, 5 * 60 * 1000).unref();

const today = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

/** Counts a profile open. Fire-and-forget: never throws, never slows the request. */
export async function recordArtistClick(artistId: string, visitorKey: string) {
  const key = `${visitorKey}:${artistId}`;
  const now = Date.now();
  if ((seen.get(key) ?? 0) > now) return;
  seen.set(key, now + DEDUPE_MS);

  try {
    const day = today();
    await prisma.$transaction([
      prisma.artist.update({ where: { id: artistId }, data: { viewCount: { increment: 1 } } }),
      prisma.artistDailyView.upsert({
        where: { artistId_day: { artistId, day } },
        create: { artistId, day, count: 1 },
        update: { count: { increment: 1 } },
      }),
    ]);
  } catch (err) {
    seen.delete(key);
    console.warn('recordArtistClick failed', err);
  }
}

/** Clicks per artist over the trending window. */
export async function weeklyViews(artistIds?: string[]) {
  const since = new Date(today().getTime() - (TRENDING_DAYS - 1) * 86_400_000);
  const rows = await prisma.artistDailyView.groupBy({
    by: ['artistId'],
    where: { day: { gte: since }, ...(artistIds && { artistId: { in: artistIds } }) },
    _sum: { count: true },
  });
  return new Map(rows.map((r) => [r.artistId, r._sum.count ?? 0]));
}

/**
 * Ids of artists matching `where`, ordered by trending: weekly clicks, then all-time
 * clicks, then followers. Sorting happens in memory: the catalog is small, and this keeps
 * every existing filter usable without hand-written SQL.
 */
export async function trendingIds(where: Prisma.ArtistWhereInput) {
  const candidates = await prisma.artist.findMany({
    where,
    select: { id: true, name: true, viewCount: true, _count: { select: { followers: true } } },
  });
  const weekly = await weeklyViews(candidates.map((c) => c.id));
  return candidates
    .map((c) => ({ ...c, week: weekly.get(c.id) ?? 0 }))
    .sort(
      (a, b) =>
        b.week - a.week || b.viewCount - a.viewCount || b._count.followers - a._count.followers || a.name.localeCompare(b.name),
    )
    .map((c) => ({ id: c.id, week: c.week, allTime: c.viewCount }));
}

/** Top artists by weekly clicks, as artist cards with view counts attached. */
export async function topArtists(limit: number, userId?: string) {
  const ranked = (await trendingIds({})).slice(0, limit);
  const cards = await prisma.artist.findMany({ where: { id: { in: ranked.map((r) => r.id) } }, select: artistCardSelect });
  const byId = new Map(cards.map((c) => [c.id, c]));
  const ordered = ranked.flatMap((r) => {
    const card = byId.get(r.id);
    return card ? [{ ...card, views: { week: r.week, allTime: r.allTime } }] : [];
  });
  return withFollowFlags(userId, ordered);
}
