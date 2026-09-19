import { prisma } from '../../lib/prisma';
import { artistCardSelect, songCardSelect, withFollowFlags, withLikeFlags } from '../catalog/selects';
import { recentlyViewed } from '../me/me.routes';
import { playlistCardSelect } from '../playlists/playlists.routes';
import { getSiteConfig, type SiteConfig } from '../site/config';
import { topArtists } from '../catalog/views';
import { listShows } from '../shows/shows.routes';

/**
 * Home feed = cover story + ordered list of typed sections. The order, visibility and
 * headings come from the admin-editable layout (SiteSetting "sections"); clients just
 * render each `kind`, so the layout can change without client releases.
 */
export type SectionKind = 'songs' | 'artists' | 'recent' | 'playlists' | 'genres' | 'chart' | 'scenes' | 'artist-ranking' | 'shows';

export interface HomeSection {
  id: string;
  kind: SectionKind;
  title: string;
  subtitle?: string;
  /** Optional "see all" link for clients, expressed as a catalog query. */
  seeAll?: { type: 'artists' | 'songs'; params: Record<string, string> };
  items: unknown[];
}

const SECTION_SIZE = 12;

interface UserContext {
  userId: string;
  displayName: string;
  onboarded: boolean;
  followedIds: string[];
  likedSongIds: string[];
  tasteGenreIds: string[];
  tasteArtistIds: string[];
  favoriteGenres: { id: string; slug: string; name: string }[];
  favoriteRegions: { id: string; slug: string; name: string }[];
}

async function loadUserContext(userId: string): Promise<UserContext | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      displayName: true,
      onboarded: true,
      favoriteGenres: { select: { id: true, slug: true, name: true } },
      favoriteRegions: { select: { id: true, slug: true, name: true } },
      follows: { select: { artistId: true } },
      likes: { select: { songId: true, song: { select: { artistId: true, genres: { select: { id: true } } } } } },
    },
  });
  if (!user) return null;
  const followedIds = user.follows.map((f) => f.artistId);
  const likedArtistIds = user.likes.map((l) => l.song.artistId);
  return {
    userId,
    displayName: user.displayName,
    onboarded: user.onboarded,
    followedIds,
    likedSongIds: user.likes.map((l) => l.songId),
    tasteGenreIds: [
      ...new Set([...user.favoriteGenres.map((g) => g.id), ...user.likes.flatMap((l) => l.song.genres.map((g) => g.id))]),
    ],
    tasteArtistIds: [...new Set([...followedIds, ...likedArtistIds])],
    favoriteGenres: user.favoriteGenres,
    favoriteRegions: user.favoriteRegions,
  };
}

// ---------- Section builders ----------

type Builder = (ctx: UserContext | null, userId: string | undefined, config: SiteConfig) => Promise<HomeSection[]>;

const songs = (userId: string | undefined, args: Parameters<typeof prisma.song.findMany>[0]) =>
  prisma.song.findMany({ ...args, select: songCardSelect }).then((s) => withLikeFlags(userId, s));

const artists = (userId: string | undefined, args: Parameters<typeof prisma.artist.findMany>[0]) =>
  prisma.artist.findMany({ ...args, select: artistCardSelect }).then((a) => withFollowFlags(userId, a));

/** Chart = pinned songs (in order) + most-liked songs, minus exclusions. */
export async function buildChart(config: SiteConfig['chart'], userId?: string) {
  const { pinnedSongIds, excludedSongIds, size } = config;
  const pinnedRows = pinnedSongIds.length ? await songs(userId, { where: { id: { in: pinnedSongIds } } }) : [];
  const pinned = pinnedSongIds.flatMap((id) => pinnedRows.filter((s) => s.id === id)).map((s) => ({ ...s, pinned: true }));
  const rest = await songs(userId, {
    where: { id: { notIn: [...pinnedSongIds, ...excludedSongIds] } },
    orderBy: [{ likes: { _count: 'desc' } }, { releaseDate: { sort: 'desc', nulls: 'last' } }],
    take: Math.max(0, size - pinned.length),
  });
  return [...pinned, ...rest.map((s) => ({ ...s, pinned: false }))];
}

const BUILDERS: Record<string, Builder> = {
  chart: async (_ctx, userId, config) => [
    {
      id: 'chart',
      kind: 'chart',
      title: config.chart.title ?? 'The Chart',
      subtitle: 'Most liked right now',
      seeAll: { type: 'songs', params: { sort: 'popular' } },
      items: await buildChart(config.chart, userId),
    },
  ],

  scenes: async () => [
    {
      id: 'scenes',
      kind: 'scenes',
      title: 'Scenes',
      subtitle: 'Rep your city',
      // Biggest scenes only: the front-page block sits beside the 10-song chart.
      items: await prisma.region.findMany({
        where: { artists: { some: {} } },
        orderBy: [{ artists: { _count: 'desc' } }, { name: 'asc' }],
        take: 8,
        select: { id: true, slug: true, name: true, state: true, _count: { select: { artists: true } } },
      }),
    },
  ],

  'trending-artists': async (_ctx, userId) => [
    {
      id: 'trending-artists',
      kind: 'artist-ranking',
      title: 'Most viewed this week',
      subtitle: 'Ranked by profile clicks',
      seeAll: { type: 'artists', params: { sort: 'trending' } },
      items: await topArtists(10, userId),
    },
  ],

  shows: async () => [
    {
      id: 'shows',
      kind: 'shows',
      title: 'Rap shows',
      subtitle: 'Battles, cyphers and the winners they made',
      items: await listShows(),
    },
  ],

  recent: async (ctx) =>
    ctx ? [{ id: 'recent', kind: 'recent', title: 'Jump back in', items: await recentlyViewed(ctx.userId, SECTION_SIZE) }] : [],

  following: async (ctx, userId) =>
    ctx?.followedIds.length
      ? [
          {
            id: 'following',
            kind: 'songs',
            title: 'New from artists you follow',
            items: await songs(userId, {
              where: { OR: [{ artistId: { in: ctx.followedIds } }, { features: { some: { artistId: { in: ctx.followedIds } } } }] },
              orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
              take: SECTION_SIZE,
            }),
          },
        ]
      : [],

  'made-for-you': async (ctx, userId) => {
    if (!ctx || (!ctx.tasteGenreIds.length && !ctx.tasteArtistIds.length)) return [];
    const or = [
      ...(ctx.tasteGenreIds.length ? [{ genres: { some: { id: { in: ctx.tasteGenreIds } } } }] : []),
      ...(ctx.tasteArtistIds.length
        ? [{ artistId: { in: ctx.tasteArtistIds } }, { features: { some: { artistId: { in: ctx.tasteArtistIds } } } }]
        : []),
    ];
    return [
      {
        id: 'made-for-you',
        kind: 'songs',
        title: 'Made for you',
        subtitle: 'Based on your likes, follows and favourite sounds',
        items: await songs(userId, {
          where: { id: { notIn: ctx.likedSongIds }, OR: or },
          orderBy: [{ likes: { _count: 'desc' } }, { releaseDate: { sort: 'desc', nulls: 'last' } }],
          take: SECTION_SIZE,
        }),
      },
    ];
  },

  // One section per favourite genre / region (so its heading can't be overridden).
  taste: async (ctx, userId) => {
    if (!ctx) return [];
    const genreSections = ctx.favoriteGenres.slice(0, 3).map(async (genre): Promise<HomeSection> => ({
      id: `genre-${genre.slug}`,
      kind: 'artists',
      title: `Because you like ${genre.name}`,
      seeAll: { type: 'artists', params: { genre: genre.slug } },
      items: await artists(userId, {
        where: { id: { notIn: ctx.followedIds }, genres: { some: { id: genre.id } } },
        orderBy: { followers: { _count: 'desc' } },
        take: SECTION_SIZE,
      }),
    }));
    const regionSections = ctx.favoriteRegions.slice(0, 2).map(async (region): Promise<HomeSection> => ({
      id: `region-${region.slug}`,
      kind: 'songs',
      title: `Straight outta ${region.name}`,
      seeAll: { type: 'songs', params: { region: region.slug } },
      items: await songs(userId, {
        where: { artist: { regionId: region.id } },
        orderBy: [{ likes: { _count: 'desc' } }, { releaseDate: { sort: 'desc', nulls: 'last' } }],
        take: SECTION_SIZE,
      }),
    }));
    return Promise.all([...genreSections, ...regionSections]);
  },

  'suggested-artists': async (ctx, userId) => {
    if (!ctx) return [];
    const followedMeta = ctx.followedIds.length
      ? await prisma.artist.findMany({ where: { id: { in: ctx.followedIds } }, select: { regionId: true, genres: { select: { id: true } } } })
      : [];
    const genreIds = [...new Set([...ctx.tasteGenreIds, ...followedMeta.flatMap((a) => a.genres.map((g) => g.id))])];
    const regionIds = [
      ...new Set([...ctx.favoriteRegions.map((r) => r.id), ...followedMeta.flatMap((a) => (a.regionId ? [a.regionId] : []))]),
    ];
    const or = [
      ...(genreIds.length ? [{ genres: { some: { id: { in: genreIds } } } }] : []),
      ...(regionIds.length ? [{ regionId: { in: regionIds } }] : []),
    ];
    return [
      {
        id: 'suggested-artists',
        kind: 'artists',
        title: 'Artists you might like',
        items: await artists(userId, {
          where: { id: { notIn: ctx.followedIds }, ...(or.length ? { OR: or } : {}) },
          orderBy: { followers: { _count: 'desc' } },
          take: SECTION_SIZE,
        }),
      },
    ];
  },

  'featured-artists': async (_ctx, userId) => [
    {
      id: 'featured-artists',
      kind: 'artists',
      title: 'Artists to know',
      seeAll: { type: 'artists', params: {} },
      items: await artists(userId, { where: { featured: true }, orderBy: { followers: { _count: 'desc' } }, take: SECTION_SIZE }),
    },
  ],

  playlists: async (ctx) =>
    ctx
      ? [
          {
            id: 'playlists',
            kind: 'playlists',
            title: 'Your playlists',
            items: await prisma.playlist.findMany({
              where: { userId: ctx.userId },
              orderBy: { updatedAt: 'desc' },
              take: SECTION_SIZE,
              select: playlistCardSelect,
            }),
          },
        ]
      : [],

  'new-releases': async (_ctx, userId) => [
    {
      id: 'new-releases',
      kind: 'songs',
      title: 'Fresh drops',
      seeAll: { type: 'songs', params: { sort: 'new' } },
      items: await songs(userId, { where: { releaseDate: { not: null } }, orderBy: { releaseDate: 'desc' }, take: SECTION_SIZE }),
    },
  ],

  sounds: async () => [
    {
      id: 'sounds',
      kind: 'genres',
      title: 'Sounds',
      subtitle: 'Browse by sound',
      items: await prisma.genre.findMany({
        orderBy: { songs: { _count: 'desc' } },
        select: { id: true, slug: true, name: true, _count: { select: { songs: true, artists: true } } },
      }),
    },
  ],
};

/** Editor-curated section: hand-picked songs or artists, in the chosen order. */
async function buildCustom(
  item: SiteConfig['sections']['items'][number],
  userId: string | undefined,
): Promise<HomeSection[]> {
  const custom = item.custom;
  if (!custom?.ids.length) return [];
  const rows: { id: string }[] =
    custom.kind === 'songs'
      ? await songs(userId, { where: { id: { in: custom.ids } } })
      : await artists(userId, { where: { id: { in: custom.ids } } });
  const ordered = custom.ids.flatMap((id) => rows.filter((r) => r.id === id));
  return [{ id: item.key, kind: custom.kind, title: item.title ?? 'Editor’s picks', subtitle: item.subtitle ?? undefined, items: ordered }];
}

// ---------- Cover story ----------

/** Carousel size bounds: auto fill tops up to MIN, editor slides can go up to MAX. */
const MIN_SLIDES = 3;
const MAX_SLIDES = 8;

type Hero = NonNullable<Awaited<ReturnType<typeof heroFor>>>;

/** Latest drops, one per artist, from followed artists (or featured ones). */
async function autoHeroes(userId: string | undefined, followedIds: string[], count: number, skipArtistIds: Set<string>) {
  if (count <= 0) return [];
  const pick = async (where: object, reason: 'following' | 'featured', n: number) => {
    if (n <= 0) return [];
    const rows = await prisma.song.findMany({
      where: { ...where, artistId: { notIn: [...skipArtistIds] } },
      orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } },
      distinct: ['artistId'],
      take: n,
      select: { id: true, artistId: true },
    });
    rows.forEach((r) => skipArtistIds.add(r.artistId));
    return Promise.all(rows.map((r) => heroFor(r.artistId, r.id, userId, reason)));
  };
  const mine = followedIds.length ? await pick({ AND: [{ artistId: { in: followedIds } }] }, 'following', count) : [];
  const featured = await pick({ artist: { featured: true } }, 'featured', count - mine.length);
  // Not enough featured artists with songs: fall back to the newest drops overall.
  const fresh = await pick({}, 'featured', count - mine.length - featured.length);
  return [...mine, ...featured, ...fresh].filter((h): h is Hero => !!h);
}

async function heroFor(
  artistId: string,
  songId: string | null,
  userId: string | undefined,
  reason: 'following' | 'featured' | 'editorial',
  overrides: { kicker?: string | null; blurb?: string | null } = {},
) {
  const [artist, song] = await Promise.all([
    prisma.artist.findUnique({ where: { id: artistId }, select: { ...artistCardSelect, bio: true, bannerUrl: true } }),
    songId
      ? prisma.song.findUnique({ where: { id: songId }, select: songCardSelect })
      : prisma.song.findFirst({ where: { artistId }, orderBy: { releaseDate: { sort: 'desc', nulls: 'last' } }, select: songCardSelect }),
  ]);
  if (!artist) return null;
  const [[flaggedArtist], flaggedSongs] = await Promise.all([withFollowFlags(userId, [artist]), withLikeFlags(userId, song ? [song] : [])]);
  return {
    artist: flaggedArtist,
    song: flaggedSongs[0] ?? null,
    reason,
    kicker: overrides.kicker ?? null,
    blurb: overrides.blurb ?? null,
  };
}

/**
 * Cover-story carousel: live editor slides (in order) plus automatic slides up to
 * MIN_SLIDES. Users who follow artists see their personal slides first unless the
 * editor forces the picks to lead for everyone.
 */
async function buildHeroes(config: SiteConfig['coverStory'], userId: string | undefined, ctx: UserContext | null): Promise<Hero[]> {
  if (config.mode === 'hidden') return [];
  const now = Date.now();
  const live =
    config.mode === 'manual'
      ? config.slides.filter((s) => (!s.startsAt || Date.parse(s.startsAt) <= now) && (!s.endsAt || Date.parse(s.endsAt) > now))
      : [];
  // Missing artists (deleted since) drop out.
  const editorial = (await Promise.all(live.map((s) => heroFor(s.artistId, s.songId, userId, 'editorial', s)))).filter(
    (h): h is Hero => !!h,
  );

  const followedIds = ctx?.followedIds ?? [];
  const wantAuto = config.mode === 'auto' || config.autoFill;
  const autoCount = wantAuto ? Math.max(0, MIN_SLIDES - editorial.length) : 0;
  const auto = await autoHeroes(userId, followedIds, autoCount, new Set(editorial.map((h) => h.artist.id)));

  const personalFirst = followedIds.length > 0 && !config.forceForEveryone;
  const ordered = personalFirst
    ? [...auto.filter((h) => h.reason === 'following'), ...editorial, ...auto.filter((h) => h.reason !== 'following')]
    : [...editorial, ...auto];
  return ordered.slice(0, MAX_SLIDES);
}

// ---------- Entry point ----------

export async function buildHome(userId?: string) {
  const [config, ctx] = await Promise.all([getSiteConfig(), userId ? loadUserContext(userId) : Promise.resolve(null)]);
  const effectiveUserId = ctx ? userId : undefined;
  const layout = config.sections.items.filter((item) => item.visible);

  const [heroes, built] = await Promise.all([
    buildHeroes(config.coverStory, effectiveUserId, ctx),
    Promise.all(
      layout.map(async (item) => {
        if (item.custom) return buildCustom(item, effectiveUserId);
        const builder = BUILDERS[item.key];
        if (!builder) return [];
        const sections = await builder(ctx, effectiveUserId, config);
        // Heading overrides apply to single-section blocks only ("taste" expands per genre/city).
        if (sections.length === 1) {
          if (item.title) sections[0].title = item.title;
          if (item.subtitle) sections[0].subtitle = item.subtitle;
        }
        return sections;
      }),
    ),
  ]);

  return {
    personalized: !!ctx,
    onboarded: ctx?.onboarded,
    greetingName: ctx?.displayName,
    /** Cover-story carousel slides, in order. */
    heroes,
    /** Seconds per slide when autoplaying. */
    heroInterval: config.coverStory.intervalSeconds,
    /** First slide, kept for older clients. */
    hero: heroes[0] ?? null,
    sections: built.flat().filter((s) => s.items.length > 0),
  };
}
