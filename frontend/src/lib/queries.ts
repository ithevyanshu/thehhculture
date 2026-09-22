import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from './api';
import { issueNumber } from './format';
import { useAuth } from '../auth/AuthContext';
import type {
  AlbumCard,
  ArtistCard,
  ArtistDetail,
  Genre,
  HomeResponse,
  EventCard,
  EventDetail,
  Membership,
  Paged,
  PlaylistCard,
  PlaylistDetail,
  RecentItem,
  Region,
  ShowAppearance,
  ArtistPost,
  ShowCard,
  ShowDetail,
  SiteInfo,
  SongCard,
} from './types';

type Params = Record<string, string | number | undefined>;

export const useHome = () => useQuery({ queryKey: ['home'], queryFn: () => api<HomeResponse>('/home') });

export const useShows = () =>
  useQuery({ queryKey: ['shows'], queryFn: () => api<{ items: ShowCard[] }>('/shows'), staleTime: 5 * 60_000 });

/** Live events. `when` is upcoming (default), past or all. */
export const useEvents = (params: Record<string, string | number> = {}) =>
  useQuery({ queryKey: ['events', params], queryFn: () => api<Paged<EventCard>>('/events', { query: params }), placeholderData: (prev) => prev });

export const useEvent = (slug: string) =>
  useQuery({ queryKey: ['event', slug], queryFn: () => api<{ event: EventDetail; related: EventCard[] }>(`/events/${slug}`) });

export const useShow = (slug: string) =>
  useQuery({ queryKey: ['show', slug], queryFn: () => api<{ show: ShowDetail }>(`/shows/${slug}`) });

export const useSite = () => useQuery({ queryKey: ['site'], queryFn: () => api<SiteInfo>('/site'), staleTime: 60_000 });

/** Issue number from the admin setting; week of the year until the site info loads. */
export const useIssueNumber = () => useSite().data?.issue ?? issueNumber();

export const useGenres = () =>
  useQuery({ queryKey: ['genres'], queryFn: () => api<{ items: Genre[] }>('/genres'), staleTime: 10 * 60_000 });

export const useRegions = () =>
  useQuery({ queryKey: ['regions'], queryFn: () => api<{ items: Region[] }>('/regions'), staleTime: 10 * 60_000 });

export const useArtists = (params: Params, enabled = true) =>
  useQuery({
    queryKey: ['artists', params],
    queryFn: () => api<Paged<ArtistCard>>('/artists', { query: params }),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useArtist = (slug: string) =>
  useQuery({
    queryKey: ['artist', slug],
    queryFn: () =>
      api<{
        artist: ArtistDetail;
        topSongs: SongCard[];
        latestSongs: SongCard[];
        featuredOn: SongCard[];
        related: ArtistCard[];
        produced: SongCard[];
        appearances: ShowAppearance[];
        /** Latest Studio posts from the artist. */
        posts: ArtistPost[];
        /** Upcoming dates this artist is on the bill for. */
        events: EventCard[];
        /** Who is in this group (empty for a solo artist). */
        members: Membership[];
        /** Groups this artist belongs to. */
        memberOf: Membership[];
        /** Each group they are in, with that group's best songs. */
        groupWork: { group: ArtistCard; songs: SongCard[] }[];
      }>(
        `/artists/${slug}`,
      ),
  });

export const useArtistSongs = (slug: string, params: Params) =>
  useQuery({
    queryKey: ['artist-songs', slug, params],
    queryFn: () => api<Paged<SongCard>>(`/artists/${slug}/songs`, { query: params }),
    placeholderData: (prev) => prev,
  });

export const useSongs = (params: Params, enabled = true) =>
  useQuery({
    queryKey: ['songs', params],
    queryFn: () => api<Paged<SongCard>>('/songs', { query: params }),
    placeholderData: (prev) => prev,
    enabled,
  });

export const useSong = (slug: string) =>
  useQuery({
    queryKey: ['song', slug],
    queryFn: () => api<{ song: SongCard & { lyricsUrl: string | null }; moreFromArtist: SongCard[]; similar: SongCard[] }>(`/songs/${slug}`),
  });

export const useAlbum = (slug: string) =>
  useQuery({
    queryKey: ['album', slug],
    queryFn: () => api<{ album: AlbumCard & { songs: SongCard[]; artist: ArtistCard }; moreAlbums: AlbumCard[] }>(`/albums/${slug}`),
  });

export const useSearch = (q: string) =>
  useQuery({
    queryKey: ['search', q],
    queryFn: () => api<{ artists: ArtistCard[]; songs: SongCard[]; albums: AlbumCard[] }>('/search', { query: { q } }),
    enabled: q.trim().length > 0,
    placeholderData: (prev) => prev,
  });

export const useFollowing = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['me', 'following'],
    queryFn: () => api<Paged<ArtistCard>>('/me/following', { query: { limit: 100 } }),
    enabled: !!user,
  });
};

export const useLikes = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['me', 'likes'],
    queryFn: () => api<Paged<SongCard>>('/me/likes', { query: { limit: 100 } }),
    enabled: !!user,
  });
};

export const useRecent = () => {
  const { user } = useAuth();
  return useQuery({ queryKey: ['me', 'recent'], queryFn: () => api<{ items: RecentItem[] }>('/me/recent'), enabled: !!user });
};

export const useMyPlaylists = () => {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['me', 'playlists'],
    queryFn: () => api<{ items: PlaylistCard[] }>('/playlists/mine'),
    enabled: !!user,
  });
};

export const usePlaylist = (id: string) =>
  useQuery({ queryKey: ['playlist', id], queryFn: () => api<{ playlist: PlaylistDetail }>(`/playlists/${id}`) });

/** Returns a function that sends anonymous users to login and back. */
export function useRequireLogin() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  return () => {
    if (user) return true;
    navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`);
    return false;
  };
}

/** Invalidate everything that shows follow/like state. */
function useInvalidateActivity() {
  const qc = useQueryClient();
  return () =>
    Promise.all(
      ['home', 'me', 'artist', 'artists', 'song', 'songs', 'album', 'search', 'artist-songs', 'playlist'].map((k) =>
        qc.invalidateQueries({ queryKey: [k] }),
      ),
    );
}

export function useToggleFollow() {
  const invalidate = useInvalidateActivity();
  return useMutation({
    mutationFn: ({ slug, follow }: { slug: string; follow: boolean }) =>
      api<{ isFollowing: boolean; followers: number }>(`/artists/${slug}/follow`, { method: follow ? 'POST' : 'DELETE' }),
    onSuccess: invalidate,
  });
}

export function useToggleLike() {
  const invalidate = useInvalidateActivity();
  return useMutation({
    mutationFn: ({ slug, like }: { slug: string; like: boolean }) =>
      api<{ isLiked: boolean; likes: number }>(`/songs/${slug}/like`, { method: like ? 'POST' : 'DELETE' }),
    onSuccess: invalidate,
  });
}
