// Mirrors the backend response shapes (see backend/src/modules/catalog/selects.ts).

export type Role = 'USER' | 'ADMIN' | 'ARTIST';
export type AlbumType = 'ALBUM' | 'EP' | 'MIXTAPE' | 'SINGLE';

export interface Taxon {
  id?: string;
  slug: string;
  name: string;
}

export interface Genre extends Taxon {
  id: string;
  description?: string | null;
  _count?: { artists: number; songs: number };
}

export interface Region extends Taxon {
  id: string;
  state?: string | null;
  _count?: { artists: number };
}

export interface User {
  id: string;
  email: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  role: Role;
  onboarded: boolean;
  createdAt: string;
  favoriteGenres: Taxon[];
  favoriteRegions: Taxon[];
}

export interface ArtistRef {
  id: string;
  slug: string;
  name: string;
  /** Instagram-style @handle (without the @). */
  handle?: string | null;
  imageUrl?: string | null;
}

export interface ArtistCard extends ArtistRef {
  imageUrl: string | null;
  verified: boolean;
  instagramUrl?: string | null;
  isProducer?: boolean;
  region: Taxon | null;
  genres: Taxon[];
  _count: { followers: number; songs: number };
  isFollowing: boolean;
  /** Present on trending lists: de-duplicated profile clicks. */
  views?: { week: number; allTime: number };
}

export interface AlbumCard {
  id: string;
  slug: string;
  title: string;
  type: AlbumType;
  releaseDate: string | null;
  coverUrl: string | null;
  artist: ArtistRef;
  _count: { songs: number };
}

export interface SongCard {
  id: string;
  slug: string;
  title: string;
  coverUrl: string | null;
  releaseDate: string | null;
  durationSec: number | null;
  explicit: boolean;
  spotifyTrackId: string | null;
  youtubeVideoId: string | null;
  artist: ArtistRef;
  features: { artist: ArtistRef }[];
  producers?: { artist: ArtistRef }[];
  album: { id: string; slug: string; title: string; coverUrl: string | null } | null;
  genres: Taxon[];
  _count: { likes: number };
  isLiked: boolean;
  trackNumber?: number | null;
}

export interface ArtistDetail extends ArtistCard {
  realName: string | null;
  bio: string | null;
  imageCredit: string | null;
  imageSourceUrl: string | null;
  bannerUrl: string | null;
  activeSince: number | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  spotifyUrl: string | null;
  spotifyId: string | null;
  featured: boolean;
  albums: AlbumCard[];
  stats: { followers: number; songs: number; likes: number };
}

export interface PlaylistCard {
  id: string;
  name: string;
  description: string | null;
  isPublic: boolean;
  createdAt: string;
  updatedAt: string;
  user: { id: string; username: string; displayName: string };
  _count: { songs: number };
  songs: { song: { coverUrl: string | null; album: { coverUrl: string | null } | null } }[];
}

export interface PlaylistDetail extends Omit<PlaylistCard, 'songs'> {
  songs: SongCard[];
  isOwner: boolean;
}

export type RecentItem =
  | { kind: 'artist'; viewedAt: string; artist: ArtistCard }
  | { kind: 'song'; viewedAt: string; song: SongCard };

export type HomeSection =
  | { id: string; kind: 'songs'; title: string; subtitle?: string; seeAll?: SeeAll; items: SongCard[] }
  | { id: string; kind: 'artists'; title: string; subtitle?: string; seeAll?: SeeAll; items: ArtistCard[] }
  | { id: string; kind: 'recent'; title: string; subtitle?: string; seeAll?: SeeAll; items: RecentItem[] }
  | { id: string; kind: 'playlists'; title: string; subtitle?: string; seeAll?: SeeAll; items: PlaylistCard[] }
  | { id: string; kind: 'genres'; title: string; subtitle?: string; seeAll?: SeeAll; items: Genre[] }
  | { id: string; kind: 'chart'; title: string; subtitle?: string; seeAll?: SeeAll; items: (SongCard & { pinned?: boolean })[] }
  | { id: string; kind: 'scenes'; title: string; subtitle?: string; seeAll?: SeeAll; items: Region[] }
  | { id: string; kind: 'artist-ranking'; title: string; subtitle?: string; seeAll?: SeeAll; items: ArtistCard[] }
  | { id: string; kind: 'shows'; title: string; subtitle?: string; seeAll?: SeeAll; items: ShowCard[] };

export interface SeeAll {
  type: 'artists' | 'songs';
  params: Record<string, string>;
}

export interface HomeResponse {
  personalized: boolean;
  onboarded?: boolean;
  greetingName?: string;
  hero: {
    artist: ArtistCard & { bio: string | null; bannerUrl: string | null };
    song: SongCard | null;
    reason: 'following' | 'featured' | 'editorial';
    kicker: string | null;
    blurb: string | null;
  } | null;
  sections: HomeSection[];
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paged<T> {
  items: T[];
  meta: PageMeta;
}

// ---------- Site chrome (/site) ----------

export type Tone = 'saffron' | 'ink' | 'red' | 'neon';

export interface SiteInfo {
  announcement: { text: string; linkUrl: string | null; linkLabel: string | null; tone: Tone } | null;
  ticker: {
    label: string;
    items: (
      | { type: 'song'; song: { id: string; slug: string; title: string; artist: { name: string; slug: string } } }
      | { type: 'text'; text: string; linkUrl: string | null }
    )[];
  } | null;
}
// ---------- Suggestions ----------

export type SuggestionType = 'MISSING_ARTIST' | 'MISSING_SONG' | 'CORRECTION' | 'FEATURE' | 'OTHER';
export type SuggestionStatus = 'NEW' | 'PLANNED' | 'DONE' | 'DISMISSED';

export interface Suggestion {
  id: string;
  type: SuggestionType;
  message: string;
  contextUrl: string | null;
  status: SuggestionStatus;
  adminNote: string | null;
  createdAt: string;
  updatedAt: string;
}

export const SUGGESTION_TYPES: { value: SuggestionType; label: string }[] = [
  { value: 'MISSING_ARTIST', label: 'Missing artist' },
  { value: 'MISSING_SONG', label: 'Missing song / album' },
  { value: 'CORRECTION', label: 'Something is wrong' },
  { value: 'FEATURE', label: 'Feature idea' },
  { value: 'OTHER', label: 'Something else' },
];

export const SUGGESTION_STATUS_LABEL: Record<SuggestionStatus, string> = {
  NEW: 'Received',
  PLANNED: 'On it',
  DONE: 'Done',
  DISMISSED: 'Closed',
};
// ---------- Rap shows ----------

export type ShowRole = 'WINNER' | 'RUNNER_UP' | 'FINALIST' | 'CONTESTANT' | 'JUDGE' | 'GUEST_JUDGE' | 'HOST';

export const SHOW_ROLE_LABEL: Record<ShowRole, string> = {
  WINNER: 'Winner',
  RUNNER_UP: 'Runner-up',
  FINALIST: 'Finalist',
  CONTESTANT: 'Contestant',
  JUDGE: 'Judge',
  GUEST_JUDGE: 'Guest judge',
  HOST: 'Host',
};

export interface ShowCard {
  id: string;
  slug: string;
  name: string;
  network: string | null;
  description: string | null;
  logoUrl: string | null;
  _count: { seasons: number };
  latestSeason: { number: number; year: number | null; title: string | null; cast: { artist: ArtistRef }[] } | null;
}

export interface ShowSeason {
  id: string;
  number: number;
  year: number | null;
  title: string | null;
  cast: { role: ShowRole; placement?: string | null; artist: ArtistCard }[];
}

export interface ShowDetail extends Omit<ShowCard, '_count' | 'latestSeason'> {
  seasons: ShowSeason[];
}

export interface ShowAppearance {
  role: ShowRole;
  placement?: string | null;
  season: { number: number; year: number | null; title: string | null; show: { slug: string; name: string } };
}