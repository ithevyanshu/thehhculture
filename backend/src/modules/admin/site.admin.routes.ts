import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { badRequest, param, parse } from '../../lib/http';
import { currentUser } from '../../middleware/auth';
import { BUILTIN_SECTIONS, SCHEMAS, SETTING_KEYS, getSiteConfig, normalizeSections, saveSetting, type SettingKey, type SiteConfig } from '../site/config';

/** Front-page / site configuration. Mounted under /admin (already admin-only). */
export const siteAdminRouter = Router();

/** Every song/artist id referenced by the config, so the UI can show names instead of ids. */
function referencedIds(config: SiteConfig) {
  const songIds = new Set<string>([
    ...config.coverStory.slides.flatMap((s) => (s.songId ? [s.songId] : [])),
    ...config.ticker.items.flatMap((i) => (i.type === 'song' ? [i.songId] : [])),
    ...config.chart.pinnedSongIds,
    ...config.chart.excludedSongIds,
  ]);
  const artistIds = new Set<string>(config.coverStory.slides.map((s) => s.artistId));
  for (const item of config.sections.items) {
    if (item.custom?.kind === 'songs') item.custom.ids.forEach((id) => songIds.add(id));
    if (item.custom?.kind === 'artists') item.custom.ids.forEach((id) => artistIds.add(id));
  }
  return { songIds: [...songIds], artistIds: [...artistIds] };
}

siteAdminRouter.get('/site-config', async (_req, res) => {
  const config = await getSiteConfig();
  const { songIds, artistIds } = referencedIds(config);
  const [songs, artists] = await Promise.all([
    prisma.song.findMany({
      where: { id: { in: songIds } },
      select: { id: true, slug: true, title: true, coverUrl: true, artist: { select: { name: true } } },
    }),
    prisma.artist.findMany({ where: { id: { in: artistIds } }, select: { id: true, slug: true, name: true, imageUrl: true } }),
  ]);
  res.json({
    config,
    builtins: BUILTIN_SECTIONS,
    refs: {
      songs: Object.fromEntries(songs.map((s) => [s.id, { id: s.id, slug: s.slug, title: s.title, coverUrl: s.coverUrl, artistName: s.artist.name }])),
      artists: Object.fromEntries(artists.map((a) => [a.id, a])),
    },
  });
});

siteAdminRouter.put('/site-config/:key', async (req, res) => {
  const key = param(req, 'key');
  if (!SETTING_KEYS.includes(key as SettingKey)) throw badRequest(`Unknown setting "${key}"`);
  const k = key as SettingKey;
  let value = parse(SCHEMAS[k] as z.ZodTypeAny, req.body) as SiteConfig[typeof k];

  // Referenced records must exist.
  const { songIds, artistIds } = referencedIds({ ...(await getSiteConfig()), [k]: value } as SiteConfig);
  const [songCount, artistCount] = await Promise.all([
    prisma.song.count({ where: { id: { in: songIds } } }),
    prisma.artist.count({ where: { id: { in: artistIds } } }),
  ]);
  if (songCount !== songIds.length || artistCount !== artistIds.length) {
    throw badRequest('Some selected songs or artists no longer exist. Refresh and try again.');
  }

  if (k === 'sections') value = normalizeSections(value as SiteConfig['sections']) as SiteConfig[typeof k];
  await saveSetting(k, value, currentUser(req).id);
  res.json({ key: k, value });
});
