/**
 * Artist photos from Wikipedia / Wikimedia Commons (free, no API key).
 *
 * Images are hotlinked from upload.wikimedia.org, which Wikimedia permits, and every
 * candidate carries its author + license so the UI can show the required attribution.
 */

const API = 'https://en.wikipedia.org/w/api.php';
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
// Wikimedia asks API clients to send a descriptive User-Agent.
const USER_AGENT = 'DHHCulture/0.1 (Indian hip hop catalog; artist photo + social lookup)';
const THUMB_WIDTH = 800;

export interface ImageCandidate {
  pageTitle: string;
  description: string | null;
  pageUrl: string;
  imageUrl: string;
  /** Wikimedia Commons file page - link target for the credit. */
  sourceUrl: string;
  /** e.g. "Jane Doe / CC BY-SA 4.0" */
  credit: string | null;
}

interface WikiPage {
  title: string;
  index?: number;
  missing?: boolean;
  description?: string;
  pageimage?: string;
  thumbnail?: { source: string };
}

const MIN_INTERVAL_MS = 500; // be polite: at most ~2 requests/second
const MAX_RETRIES = 4;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let nextSlot = 0;

async function wiki<T>(params: Record<string, string>, api = API): Promise<T> {
  const qs = new URLSearchParams({ format: 'json', formatversion: '2', ...params });

  for (let attempt = 0; ; attempt++) {
    // Serialize requests through a shared schedule so bulk jobs don't get rate-limited.
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Math.max(Date.now(), nextSlot) + MIN_INTERVAL_MS;
    if (wait) await sleep(wait);

    const res = await fetch(`${api}?${qs}`, { headers: { 'User-Agent': USER_AGENT } });
    if (res.ok) return (await res.json()) as T;

    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000 * 2 ** attempt;
      nextSlot = Date.now() + backoff;
      continue;
    }
    throw new Error(`Wikimedia API responded ${res.status}`);
  }
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Look up author + license for a batch of Commons files. */
async function credits(fileNames: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (!fileNames.length) return out;
  type Resp = {
    query?: {
      normalized?: { from: string; to: string }[];
      pages?: { title: string; imageinfo?: { extmetadata?: Record<string, { value: string }> }[] }[];
    };
  };
  const data = await wiki<Resp>({
    action: 'query',
    prop: 'imageinfo',
    iiprop: 'extmetadata',
    iiextmetadatafilter: 'Artist|LicenseShortName',
    titles: fileNames.map((f) => `File:${f}`).join('|'),
  });
  const norm = new Map((data.query?.normalized ?? []).map((n) => [n.to, n.from]));
  for (const page of data.query?.pages ?? []) {
    const meta = page.imageinfo?.[0]?.extmetadata ?? {};
    const author = meta.Artist?.value ? stripHtml(meta.Artist.value) : null;
    const license = meta.LicenseShortName?.value ? stripHtml(meta.LicenseShortName.value) : null;
    const credit = [author, license].filter(Boolean).join(' / ') || null;
    const requested = (norm.get(page.title) ?? page.title).replace(/^File:/, '');
    out.set(requested.replace(/ /g, '_'), credit);
    out.set(page.title.replace(/^File:/, '').replace(/ /g, '_'), credit);
  }
  return out;
}

async function toCandidates(pages: WikiPage[]): Promise<ImageCandidate[]> {
  const withImages = pages
    .filter((p) => !p.missing && p.thumbnail?.source && p.pageimage)
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  const creditMap = await credits(withImages.map((p) => p.pageimage!));
  return withImages.map((p) => ({
    pageTitle: p.title,
    description: p.description ?? null,
    pageUrl: `https://en.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`,
    imageUrl: p.thumbnail!.source,
    sourceUrl: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(p.pageimage!)}`,
    credit: creditMap.get(p.pageimage!) ?? null,
  }));
}

const pageProps = { prop: 'pageimages|description', piprop: 'thumbnail|name', pithumbsize: String(THUMB_WIDTH), redirects: '1' };

/** Free-text search; returns every result that has a lead image. */
export async function searchImages(query: string, limit = 6): Promise<ImageCandidate[]> {
  const data = await wiki<{ query?: { pages?: WikiPage[] } }>({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: String(limit),
    ...pageProps,
  });
  return toCandidates(data.query?.pages ?? []);
}

/** Exact page lookup, e.g. from a pasted Wikipedia URL. */
export async function imageForPage(title: string): Promise<ImageCandidate[]> {
  const data = await wiki<{ query?: { pages?: WikiPage[] } }>({ action: 'query', titles: title, ...pageProps });
  return toCandidates(data.query?.pages ?? []);
}

/** Accepts a search phrase or a Wikipedia article URL. */
export async function findCandidates(input: string): Promise<ImageCandidate[]> {
  const url = input.match(/wikipedia\.org\/wiki\/([^?#]+)/);
  if (url) return imageForPage(decodeURIComponent(url[1]).replace(/_/g, ' '));
  return searchImages(input);
}

// ---------- automatic matching ----------

const MUSIC_WORDS = /\b(rapper|rap|hip[ -]?hop|singer|musician|lyricist|songwriter|music producer|duo|band|group)\b/i;

const normalize = (s: string) =>
  s
    .toLowerCase()
    .replace(/\$/g, 's')
    .replace(/δ/g, 'a')
    .replace(/\s*\([^)]*\)\s*/g, ' ') // drop "(rapper)" disambiguators
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Best-guess photo for an artist, or null when nothing is a confident match.
 * A candidate must (1) have a title matching the artist or real name and
 * (2) describe a musician - so we never attach a stranger's photo.
 */
export async function findArtistImage(artist: { name: string; realName?: string | null }): Promise<ImageCandidate | null> {
  const names = [artist.name, artist.realName].filter(Boolean).map((n) => normalize(n!));
  const queries = [`${artist.name} rapper`, `${artist.name} Indian hip hop`, artist.realName].filter(Boolean) as string[];

  for (const q of queries) {
    const candidates = await searchImages(q, 5);
    const match = candidates.find(
      (c) => names.includes(normalize(c.pageTitle)) && MUSIC_WORDS.test(c.description ?? ''),
    );
    if (match) return match;
  }
  return null;
}

// ---------- Instagram handles via Wikidata ----------

interface SearchPage {
  title: string;
  index?: number;
  description?: string;
  pageprops?: { wikibase_item?: string };
}

/**
 * The artist's Wikipedia article + Wikidata id, using the same strict match as photos
 * (title must equal the artist/real name and the description must say musician).
 */
export async function findArtistPage(artist: { name: string; realName?: string | null }) {
  const names = [artist.name, artist.realName].filter(Boolean).map((n) => normalize(n!));
  const queries = [`${artist.name} rapper`, `${artist.name} Indian hip hop`, artist.realName].filter(Boolean) as string[];
  for (const q of queries) {
    const data = await wiki<{ query?: { pages?: SearchPage[] } }>({
      action: 'query',
      generator: 'search',
      gsrsearch: q,
      gsrlimit: '5',
      prop: 'pageprops|description',
      ppprop: 'wikibase_item',
      redirects: '1',
    });
    const pages = (data.query?.pages ?? []).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    const match = pages.find((p) => names.includes(normalize(p.title)) && MUSIC_WORDS.test(p.description ?? ''));
    if (match?.pageprops?.wikibase_item) return { title: match.title, wikidataId: match.pageprops.wikibase_item };
  }
  return null;
}

interface Claim {
  rank: 'preferred' | 'normal' | 'deprecated';
  mainsnak: { datavalue?: { value: unknown } };
}

/** Instagram username (Wikidata property P2003), skipping deprecated/old handles. */
export async function instagramHandle(wikidataId: string): Promise<string | null> {
  const data = await wiki<{ entities?: Record<string, { claims?: Record<string, Claim[]> }> }>(
    { action: 'wbgetentities', ids: wikidataId, props: 'claims' },
    WIKIDATA_API,
  );
  const claims = data.entities?.[wikidataId]?.claims?.P2003 ?? [];
  const usable = claims
    .filter((c) => c.rank !== 'deprecated' && typeof c.mainsnak.datavalue?.value === 'string')
    .sort((a, b) => (a.rank === 'preferred' ? -1 : 0) - (b.rank === 'preferred' ? -1 : 0));
  return (usable[0]?.mainsnak.datavalue?.value as string | undefined) ?? null;
}

export const instagramUrl = (handle: string) => `https://www.instagram.com/${handle.replace(/^@/, '')}/`;