/**
 * iTunes Search API client: free, no key, no account, works worldwide.
 * (Deezer geo-blocks India and Spotify now needs a Premium subscription to hold an app.)
 */
import { HttpError } from '../../lib/http';

const BASE = 'https://itunes.apple.com';
const COUNTRY = process.env.ITUNES_COUNTRY ?? 'IN';

/** Apple throttles around 20 calls a minute and answers 403 when it's had enough. */
const GAP_MS = 400;
let last = 0;

async function call<T>(path: string, params: Record<string, string | number>, attempt = 0): Promise<T> {
  const wait = Math.max(0, last + GAP_MS - Date.now());
  if (wait) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();

  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries({ country: COUNTRY, ...params })) url.searchParams.set(k, String(v));

  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': 'dhhculture/1.0 (+https://dhhculture.in)' }, signal: AbortSignal.timeout(15_000) });
  } catch {
    throw new HttpError(502, 'Could not reach iTunes. Try again in a moment.');
  }
  if (!res.ok) {
    if ((res.status === 403 || res.status === 429) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
      return call<T>(path, params, attempt + 1);
    }
    throw new HttpError(502, res.status === 403 || res.status === 429 ? 'iTunes is rate-limiting us. Wait a minute and try again.' : `iTunes returned ${res.status}`);
  }
  return (await res.json()) as T;
}

export interface ItunesArtist {
  wrapperType: 'artist';
  artistId: number;
  artistName: string;
  primaryGenreName?: string;
  artistLinkUrl?: string;
}

export interface ItunesTrack {
  wrapperType: 'track';
  kind?: string;
  trackId: number;
  trackName: string;
  artistName: string;
  collectionId?: number;
  collectionName?: string;
  collectionArtistName?: string;
  trackNumber?: number;
  trackCount?: number;
  discNumber?: number;
  releaseDate?: string;
  trackTimeMillis?: number;
  trackExplicitness?: string;
  primaryGenreName?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

/** Bigger artwork from the same CDN path Apple returns. */
export const artwork = (url: string | undefined, size = 600) => url?.replace(/\/\d+x\d+bb\./, `/${size}x${size}bb.`) ?? null;

export async function searchArtists(name: string, limit = 6) {
  const { results } = await call<{ results: ItunesArtist[] }>('/search', { term: name, entity: 'musicArtist', limit });
  return results.filter((r) => r.wrapperType === 'artist');
}

/** Every track iTunes lists for this artist (newest first), with its album details. */
export async function artistTracks(itunesId: string, limit = 200) {
  const { results } = await call<{ results: (ItunesArtist | ItunesTrack)[] }>('/lookup', { id: itunesId, entity: 'song', limit });
  return results.filter((r): r is ItunesTrack => r.wrapperType === 'track' && r.kind === 'song');
}
