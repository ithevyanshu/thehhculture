/**
 * How much of our catalog could an importer fill from the free iTunes Search API?
 *
 *   npx tsx scripts/catalog-coverage.ts                # 50-artist sample (biggest + random)
 *   npx tsx scripts/catalog-coverage.ts --all          # every artist
 *   npx tsx scripts/catalog-coverage.ts --limit 100
 *   npx tsx scripts/catalog-coverage.ts --json out.json
 *
 * Read-only: queries iTunes (no key, no account) and our database, writes nothing.
 *
 * Why iTunes and not Deezer or Spotify: Deezer geo-blocks India (its API returns
 * empty results from an Indian IP), and Spotify now requires the app owner to hold a
 * Premium subscription. iTunes Search needs no key and works from anywhere.
 */
import 'dotenv/config';
import fs from 'fs';
import { prisma } from '../src/lib/prisma';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const LIMIT = Number(value('limit') ?? 50);
const COUNTRY = value('country') ?? 'IN';
const JSON_OUT = value('json');

/** Apple throttles at roughly 20 calls a minute and answers 403 when it's had enough. */
const GAP_MS = 1500;
let last = 0;
async function itunes<T>(path: string, params: Record<string, string | number>, attempt = 0): Promise<T | null> {
  const wait = Math.max(0, last + GAP_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();

  const url = new URL(`https://itunes.apple.com${path}`);
  for (const [k, v] of Object.entries({ country: COUNTRY, ...params })) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { 'User-Agent': 'dhhculture-coverage-check' } });
  if (!res.ok) {
    if ((res.status === 403 || res.status === 429) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      return itunes<T>(path, params, attempt + 1);
    }
    return null;
  }
  return (await res.json()) as T;
}

/** "KR$NA" / "Kr$na " -> "krsna", so spelling noise doesn't break matching. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD') // drops accents, so "Zäyn" matches "Zayn"
    .replace(/[Δδ]/g, 'a') // "MC STΔN" -> "mcstan"
    .replace(/\$/g, 's')
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]/g, '');

const RAP_GENRE = /hip-hop|rap|desi|punjabi|indian|world|pop|electronic|dance|alternative/i;

interface ArtistResult {
  wrapperType: 'artist';
  artistId: number;
  artistName: string;
  primaryGenreName?: string;
  artistLinkUrl?: string;
}
interface CollectionResult {
  wrapperType: 'collection';
  collectionId: number;
  collectionName: string;
  collectionType?: string;
  trackCount: number;
  releaseDate: string;
  artworkUrl100?: string;
}

interface TrackResult {
  wrapperType: 'track';
  trackName: string;
}

/**
 * Same name is not the same artist ("Bella", "Sense", "Chief" exist everywhere). When we
 * already hold songs for them, check how many of our titles appear in their iTunes catalog.
 */
async function verifyByTitles(artistId: number, titles: string[]) {
  const lookup = await itunes<{ results: (ArtistResult | TrackResult)[] }>('/lookup', { id: artistId, entity: 'song', limit: 200 });
  const theirs = new Set((lookup?.results ?? []).filter((r): r is TrackResult => r.wrapperType === 'track').map((t) => norm(t.trackName)));
  if (!theirs.size) return null;
  // Their titles carry suffixes like "(feat. X)" or "- Single", so match on a prefix.
  const hits = titles.filter((t) => [...theirs].some((x) => x.startsWith(norm(t)) || norm(t).startsWith(x)));
  return { checked: titles.length, matched: hits.length };
}

async function check(artist: { name: string; slug: string; songs: number; titles: string[] }) {
  const found = await itunes<{ results: ArtistResult[] }>('/search', { term: artist.name, entity: 'musicArtist', limit: 5 });
  const candidates = found?.results ?? [];
  const sameName = candidates.filter((c) => norm(c.artistName) === norm(artist.name));
  // Same name AND a plausible genre: guards against the US rock band called "Paradox".
  const exact = sameName.find((c) => RAP_GENRE.test(c.primaryGenreName ?? '')) ?? null;
  const wrongGenre = !exact && sameName.length > 0 ? sameName[0] : null;

  const base = {
    ...artist,
    itunesName: null as string | null,
    genre: null as string | null,
    albums: 0,
    singles: 0,
    tracks: 0,
    url: null as string | null,
    verified: null as { checked: number; matched: number } | null,
  };
  if (!exact) return { ...base, match: wrongGenre ? ('wrong-genre' as const) : ('none' as const), itunesName: wrongGenre?.artistName ?? null, genre: wrongGenre?.primaryGenreName ?? null };

  const lookup = await itunes<{ results: (ArtistResult | CollectionResult)[] }>('/lookup', { id: exact.artistId, entity: 'album', limit: 200 });
  const verified = artist.titles.length ? await verifyByTitles(exact.artistId, artist.titles) : null;
  const collections = (lookup?.results ?? []).filter((r): r is CollectionResult => r.wrapperType === 'collection');
  const singles = collections.filter((c) => c.trackCount === 1 || /- single$/i.test(c.collectionName));

  return {
    ...base,
    match: 'exact' as const,
    itunesName: exact.artistName,
    genre: exact.primaryGenreName ?? null,
    albums: collections.length - singles.length,
    singles: singles.length,
    tracks: collections.reduce((n, c) => n + (c.trackCount || 0), 0),
    url: exact.artistLinkUrl ?? null,
    verified,
  };
}

(async () => {
  // A representative sample: the artists people actually visit, plus a random tail.
  const all = await prisma.artist.findMany({
    orderBy: [{ viewCount: 'desc' }, { followers: { _count: 'desc' } }],
    select: { name: true, slug: true, _count: { select: { songs: true } }, songs: { select: { title: true }, take: 8 } },
  });
  const rows = all.map((a) => ({ name: a.name, slug: a.slug, songs: a._count.songs, titles: a.songs.map((s) => s.title) }));
  const sample = flag('all')
    ? rows
    : [...rows.slice(0, Math.ceil(LIMIT / 2)), ...rows.slice(Math.ceil(LIMIT / 2)).sort(() => Math.random() - 0.5).slice(0, Math.floor(LIMIT / 2))];

  console.log(`Checking ${sample.length} of ${rows.length} artists against iTunes (${COUNTRY}, read-only)…\n`);
  const results: Awaited<ReturnType<typeof check>>[] = [];
  for (const artist of sample) {
    const r = await check(artist);
    results.push(r);
    const mark = r.match === 'exact' ? '✓' : r.match === 'wrong-genre' ? '?' : '·';
    const detail =
      r.match === 'exact'
        ? `${r.albums} albums + ${r.singles} singles / ${r.tracks} tracks  [${r.genre}]` +
          (r.verified ? `  our titles found: ${r.verified.matched}/${r.verified.checked}` : '')
        : r.match === 'wrong-genre'
          ? `same name but ${r.genre} - probably someone else`
          : 'no match';
    console.log(`${mark} ${artist.name.padEnd(24).slice(0, 24)} ${String(artist.songs).padStart(3)} here   ${detail}`);
  }

  const exact = results.filter((r) => r.match === 'exact');
  const wrong = results.filter((r) => r.match === 'wrong-genre');
  const none = results.filter((r) => r.match === 'none');
  const pct = (n: number) => `${Math.round((n / results.length) * 100)}%`;
  const withReleases = exact.filter((r) => r.tracks > 0);

  console.log('\n---------------------------------------------');
  console.log(`Matched:            ${exact.length}/${results.length} (${pct(exact.length)})`);
  console.log(`Same name, other genre: ${wrong.length} (${pct(wrong.length)})`);
  console.log(`Not found:          ${none.length} (${pct(none.length)})`);
  console.log(`Matched artists with releases: ${withReleases.length}`);
  console.log(`Tracks available:   ${exact.reduce((n, r) => n + r.tracks, 0)}`);
  console.log(`Songs we have for them now: ${exact.reduce((n, r) => n + r.songs, 0)}`);

  // Where we hold songs already, title overlap says whether it's really the same artist.
  const checkable = exact.filter((r) => r.verified);
  const confirmed = checkable.filter((r) => r.verified!.matched > 0);
  if (checkable.length) {
    console.log(`\nMatch quality (artists whose songs we already have): ${confirmed.length}/${checkable.length} confirmed by title overlap`);
    const suspect = checkable.filter((r) => r.verified!.matched === 0);
    if (suspect.length) console.log(`Suspicious (no shared titles): ${suspect.map((r) => `${r.name} -> ${r.itunesName}`).join('; ')}`);
  }
  if (none.length) console.log(`\nNot found: ${none.map((r) => r.name).join(', ')}`);
  if (wrong.length) console.log(`\nCheck by hand: ${wrong.map((r) => `${r.name} -> ${r.itunesName} (${r.genre})`).join('; ')}`);
  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify(results, null, 2));
    console.log(`\nFull results: ${JSON_OUT}`);
  }

  await prisma.$disconnect();
})();
