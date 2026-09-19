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
  const slides = config.coverStory.slides;
  const songIds = new Set<string>([
    ...slides.flatMap((s) => (s.type === 'artist' && s.songId ? [s.songId] : [])),
    ...config.ticker.items.flatMap((i) => (i.type === 'song' ? [i.songId] : [])),
    ...config.chart.pinnedSongIds,
    ...config.chart.excludedSongIds,
  ]);
  const artistIds = new Set<string>([
    ...slides.flatMap((s) => (s.type === 'artist' ? [s.artistId] : s.artistIds)),
    ...config.ticker.items.flatMap((i) => (i.type === 'artist' ? [i.artistId] : [])),
  ]);
  const showIds = new Set<string>(config.ticker.items.flatMap((i) => (i.type === 'show' ? [i.showId] : [])));
  for (const item of config.sections.items) {
    if (item.custom?.kind === 'songs') item.custom.ids.forEach((id) => songIds.add(id));
    if (item.custom?.kind === 'artists') item.custom.ids.forEach((id) => artistIds.add(id));
  }
  return { songIds: [...songIds], artistIds: [...artistIds], showIds: [...showIds] };
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
  if (key === 'studio') throw badRequest('Studio settings are saved from Admin → Studio');
  const k = key as SettingKey;
  let value = parse(SCHEMAS[k] as z.ZodTypeAny, req.body) as SiteConfig[typeof k];

  // Referenced records must exist.
  const { songIds, artistIds, showIds } = referencedIds({ ...(await getSiteConfig()), [k]: value } as SiteConfig);
  const [songCount, artistCount, showCount] = await Promise.all([
    prisma.song.count({ where: { id: { in: songIds } } }),
    prisma.artist.count({ where: { id: { in: artistIds } } }),
    prisma.show.count({ where: { id: { in: showIds } } }),
  ]);
  if (songCount !== songIds.length || artistCount !== artistIds.length || showCount !== showIds.length) {
    throw badRequest('Some selected songs, artists or shows no longer exist. Refresh and try again.');
  }

  if (k === 'sections') value = normalizeSections(value as SiteConfig['sections']) as SiteConfig[typeof k];
  if (k === 'issue') {
    // Weekly counting starts from when the number was set, so only a changed number resets it.
    const issue = value as SiteConfig['issue'];
    const prev = (await getSiteConfig()).issue;
    const changed = issue.mode !== prev.mode || issue.number !== prev.number || !prev.since;
    value = { ...issue, since: changed ? new Date().toISOString() : prev.since } as SiteConfig[typeof k];
  }
  await saveSetting(k, value, currentUser(req).id);
  res.json({ key: k, value });
});
