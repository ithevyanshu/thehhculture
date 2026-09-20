/**
 * Admin-editable site configuration (front page, ticker, banner, chart).
 *
 * Stored as validated JSON in SiteSetting rows, so adding a new knob never needs a
 * migration. Reads are cached in-process and invalidated on write; the short TTL keeps
 * multiple API instances roughly in sync.
 */
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma';

const id = z.string().min(1).max(40);

const isoDate = z
  .string()
  .trim()
  .nullish()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid date' });
      return z.NEVER;
    }
    return d.toISOString();
  });

/** Internal path ("/artists/divine") or absolute http(s) URL. */
const link = z
  .string()
  .trim()
  .max(500)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => !v || v.startsWith('/') || /^https?:\/\//i.test(v), 'Use a path like /artists/divine or a full https:// URL');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => v || null);

// ---------- Schemas ----------

const imageUrl = z
  .string()
  .trim()
  .max(1000)
  .nullish()
  .transform((v) => v || null)
  .refine((v) => !v || /^https:\/\//i.test(v), 'Image must be an https:// link');

/** Editor-picked carousel slide: an artist feature or a news story. */
export const coverSlideSchema = z.preprocess(
  // Slides saved before news existed have no type.
  (raw) => (raw && typeof raw === 'object' && !('type' in raw) ? { ...raw, type: 'artist' } : raw),
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('artist'),
      artistId: id,
      /** Song to promote; defaults to the artist's latest release. */
      songId: id.nullish().transform((v) => v || null),
      /** Sticker text, e.g. "Album of the week". */
      kicker: optionalText(40),
      /** Replaces the artist bio on the cover. */
      blurb: optionalText(500),
      startsAt: isoDate,
      endsAt: isoDate,
    }),
    z.object({
      type: z.literal('news'),
      /** Sticker text, e.g. "Breaking". */
      kicker: optionalText(40),
      headline: z.string().trim().min(1, 'Add a headline').max(120),
      body: optionalText(600),
      imageUrl,
      /** "Read more": a page on the site (/shows/legacy) or an outside article. */
      linkUrl: link,
      linkLabel: optionalText(40),
      /** Artists in the story, shown as chips. */
      artistIds: z.array(id).max(6).default([]),
      startsAt: isoDate,
      endsAt: isoDate,
    }),
  ]),
);

export const coverStorySchema = z.preprocess(
  // Older saves held a single pick at the top level; it becomes the first slide.
  (raw) => {
    if (!raw || typeof raw !== 'object' || 'slides' in raw) return raw;
    const { artistId, songId, kicker, blurb, startsAt, endsAt, ...rest } = raw as Record<string, unknown>;
    return { ...rest, slides: artistId ? [{ type: 'artist', artistId, songId, kicker, blurb, startsAt, endsAt }] : [] };
  },
  z
    .object({
      /** auto = picked by the algorithm; manual = editor's slides (+ auto fill); hidden = no cover story */
      mode: z.enum(['auto', 'manual', 'hidden']).default('auto'),
      slides: z.array(coverSlideSchema).max(10).default([]),
      /** Top the carousel up with automatic slides when fewer than 3 editor slides are live. */
      autoFill: z.boolean().default(true),
      /** Seconds per slide while autoplaying. */
      intervalSeconds: z.number().int().min(3).max(30).default(7),
      /** When false, signed-in users who follow artists see their personal slides first. */
      forceForEveryone: z.boolean().default(false),
    })
    .refine((v) => v.mode !== 'manual' || v.slides.length > 0, { message: 'Add at least one slide', path: ['slides'] }),
);

export const announcementSchema = z
  .object({
    enabled: z.boolean().default(false),
    text: z.string().trim().max(200).default(''),
    linkUrl: link,
    linkLabel: optionalText(40),
    tone: z.enum(['saffron', 'ink', 'red', 'neon']).default('saffron'),
    expiresAt: isoDate,
  })
  .refine((v) => !v.enabled || v.text.length > 0, { message: 'Add some text before enabling the banner', path: ['text'] });

const slugList = z.array(z.string().trim().min(1).max(80)).max(20).default([]);

export const tickerItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('song'), songId: id }),
  z.object({ type: z.literal('artist'), artistId: id }),
  z.object({ type: z.literal('show'), showId: id }),
  z.object({ type: z.literal('text'), text: z.string().trim().min(1).max(120), linkUrl: link }),
]);

export const tickerSchema = z.object({
  /** auto = your items first, then the latest releases; manual = only your items; hidden = no ticker */
  mode: z.enum(['auto', 'manual', 'hidden']).default('auto'),
  label: z.string().trim().min(1).max(24).default('New drops'),
  items: z.array(tickerItemSchema).max(30).default([]),
  /** Which latest releases fill the ticker in auto mode. */
  auto: z
    .object({
      count: z.number().int().min(3).max(30).default(12),
      /** Only songs released in the last N days (null = any time). */
      withinDays: z.number().int().min(1).max(3650).nullish().transform((v) => v ?? null),
      genreSlugs: slugList,
      regionSlugs: slugList,
    })
    .default({}),
  speed: z.enum(['slow', 'normal', 'fast']).default('normal'),
  tone: z.enum(['ink', 'saffron', 'red', 'neon']).default('ink'),
});

/** Built-in front-page blocks, in their default order. */
export const BUILTIN_SECTIONS = [
  { key: 'chart', label: 'The Chart', audience: 'everyone' },
  { key: 'scenes', label: 'Scenes (cities)', audience: 'everyone' },
  { key: 'trending-artists', label: 'Most viewed this week (artist ranking)', audience: 'everyone' },
  { key: 'shows', label: 'Rap shows (latest winners)', audience: 'everyone' },
  { key: 'artist-posts', label: 'From the artists (Studio posts)', audience: 'everyone' },
  { key: 'recent', label: 'Jump back in (recently viewed)', audience: 'signed-in' },
  { key: 'following', label: 'New from artists you follow', audience: 'signed-in' },
  { key: 'made-for-you', label: 'Made for you', audience: 'signed-in' },
  { key: 'taste', label: 'Because you like… / Straight outta…', audience: 'signed-in' },
  { key: 'suggested-artists', label: 'Artists you might like', audience: 'signed-in' },
  { key: 'featured-artists', label: 'Artists to know (featured artists)', audience: 'everyone' },
  { key: 'playlists', label: 'Your playlists', audience: 'signed-in' },
  { key: 'new-releases', label: 'Fresh drops (newest songs)', audience: 'everyone' },
  { key: 'sounds', label: 'Sounds (genres)', audience: 'everyone' },
] as const;

export type BuiltinSectionKey = (typeof BUILTIN_SECTIONS)[number]['key'];
const BUILTIN_KEYS = new Set<string>(BUILTIN_SECTIONS.map((s) => s.key));

export const sectionItemSchema = z.object({
  key: z.string().trim().min(1).max(60),
  visible: z.boolean().default(true),
  /** Overrides the default heading. */
  title: optionalText(80),
  subtitle: optionalText(160),
  /** Present only for editor-curated sections (key starts with "custom-"). */
  custom: z
    .object({
      kind: z.enum(['songs', 'artists']),
      ids: z.array(id).max(24).default([]),
    })
    .optional(),
});

export const sectionsSchema = z
  .object({ items: z.array(sectionItemSchema).max(40).default([]) })
  .superRefine((v, ctx) => {
    const seen = new Set<string>();
    v.items.forEach((item, i) => {
      if (seen.has(item.key)) ctx.addIssue({ code: 'custom', message: `Duplicate section "${item.key}"`, path: ['items', i, 'key'] });
      seen.add(item.key);
      const isCustom = item.key.startsWith('custom-');
      if (isCustom && !item.custom) ctx.addIssue({ code: 'custom', message: 'Custom section needs a kind', path: ['items', i] });
      if (isCustom && !item.title) ctx.addIssue({ code: 'custom', message: 'Custom sections need a title', path: ['items', i, 'title'] });
      if (!isCustom && !BUILTIN_KEYS.has(item.key))
        ctx.addIssue({ code: 'custom', message: `Unknown section "${item.key}"`, path: ['items', i, 'key'] });
    });
  });

export const chartSchema = z.object({
  title: optionalText(60),
  subtitle: optionalText(80),
  size: z.number().int().min(5).max(25).default(10),
  /** Always shown first, in this order. */
  pinnedSongIds: z.array(id).max(10).default([]),
  /** Never shown in the chart. */
  excludedSongIds: z.array(id).max(200).default([]),
  /** Empty = the whole catalog; otherwise only these artists' songs. */
  artistIds: z.array(id).max(30).default([]),
  /** How the rest of the chart is ordered under the pinned songs. */
  sort: z.enum(['likes', 'new', 'random']).default('likes'),
  /** Stops one prolific artist filling the chart. 0 = no limit. */
  maxPerArtist: z.number().int().min(0).max(10).default(0),
});

/** Artist Studio: which kinds of artist changes go live without an admin approving them. */
export const studioSchema = z.object({
  autoPublish: z
    .object({
      /** Bio, photo, links, city, genres, handle. */
      profile: z.boolean().default(false),
      /** Songs and albums: add, edit, delete. */
      releases: z.boolean().default(false),
      /** Short updates on the artist page and in followers' feeds. */
      posts: z.boolean().default(false),
    })
    .default({}),
});

export const issueSchema = z.object({
  /** auto = week of the year; manual = the number below */
  mode: z.enum(['auto', 'manual']).default('auto'),
  number: z.number().int().min(1).max(99_999).default(1),
  /** Manual only: add one every week after the number was set. */
  countUp: z.boolean().default(true),
  /** When `number` was last changed (set by the server on save). */
  since: isoDate,
});

/** Week of the year (1-53), the default issue number. */
function weekOfYear(d: Date) {
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - start) / 86_400_000 + new Date(start).getUTCDay() + 1) / 7);
}

/** The issue number printed across the site right now. */
export function currentIssue(issue: SiteConfig['issue'], now = new Date()) {
  if (issue.mode === 'auto') return weekOfYear(now);
  if (!issue.countUp || !issue.since) return issue.number;
  return issue.number + Math.max(0, Math.floor((now.getTime() - Date.parse(issue.since)) / (7 * 86_400_000)));
}

export const SCHEMAS = {
  coverStory: coverStorySchema,
  announcement: announcementSchema,
  ticker: tickerSchema,
  sections: sectionsSchema,
  chart: chartSchema,
  issue: issueSchema,
  studio: studioSchema,
} as const;

export type SettingKey = keyof typeof SCHEMAS;
export type SiteConfig = { [K in SettingKey]: z.output<(typeof SCHEMAS)[K]> };
export const SETTING_KEYS = Object.keys(SCHEMAS) as SettingKey[];

/** Adds any built-in sections missing from a saved layout (e.g. ones introduced later). */
export function normalizeSections(value: SiteConfig['sections']): SiteConfig['sections'] {
  const present = new Set(value.items.map((i) => i.key));
  const missing = BUILTIN_SECTIONS.filter((s) => !present.has(s.key)).map((s) => ({
    key: s.key,
    visible: true,
    title: null,
    subtitle: null,
  }));
  return { items: [...value.items, ...missing] };
}

function defaults(): SiteConfig {
  return {
    coverStory: coverStorySchema.parse({}),
    announcement: announcementSchema.parse({}),
    ticker: tickerSchema.parse({}),
    sections: normalizeSections({ items: [] }),
    chart: chartSchema.parse({}),
    issue: issueSchema.parse({}),
    studio: studioSchema.parse({}),
  };
}

// ---------- Store ----------

const TTL_MS = 30_000;
let cache: { at: number; value: SiteConfig } | null = null;

export async function getSiteConfig(): Promise<SiteConfig> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value;

  const rows = await prisma.siteSetting.findMany();
  const config = defaults();
  for (const row of rows) {
    if (!(row.key in SCHEMAS)) continue;
    const key = row.key as SettingKey;
    const parsed = SCHEMAS[key].safeParse(row.value);
    // A row that no longer validates (schema changed) falls back to defaults.
    if (parsed.success) (config as Record<SettingKey, unknown>)[key] = parsed.data;
  }
  config.sections = normalizeSections(config.sections);
  cache = { at: Date.now(), value: config };
  return config;
}

export async function saveSetting<K extends SettingKey>(key: K, value: SiteConfig[K], userId: string) {
  const json = value as unknown as Prisma.InputJsonValue;
  await prisma.siteSetting.upsert({
    where: { key },
    create: { key, value: json, updatedById: userId },
    update: { value: json, updatedById: userId },
  });
  cache = null;
}
