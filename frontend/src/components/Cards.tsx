import { Link } from 'react-router-dom';
import { BadgeCheck, ListMusic, Play } from 'lucide-react';
import type { ReactNode } from 'react';
import { Artwork } from './Artwork';
import { AddToPlaylistButton, FollowButton, LikeButton } from './Buttons';
import { InstagramLink } from './Instagram';
import { duration, plural, year } from '../lib/format';
import type { AlbumCard, ArtistCard, ArtistRef, PlaylistCard, SongCard } from '../lib/types';

const TILTS = ['-rotate-2', 'rotate-1', '-rotate-1', 'rotate-2', 'rotate-[0.5deg]', '-rotate-[1.5deg]'];
function tiltFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 17 + seed.charCodeAt(i)) >>> 0;
  return TILTS[h % TILTS.length];
}

export function ArtistCredits({ artist, features, className = '' }: { artist: ArtistRef; features: { artist: ArtistRef }[]; className?: string }) {
  return (
    <span className={`truncate text-sm text-muted ${className}`}>
      <Link to={`/artists/${artist.slug}`} className="hover:text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
        {artist.name}
      </Link>
      {features.map(({ artist: f }, i) => (
        <span key={f.id}>
          {i === 0 ? ' ft. ' : ', '}
          <Link to={`/artists/${f.slug}`} className="hover:text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
            {f.name}
          </Link>
        </span>
      ))}
    </span>
  );
}

/** Taped-up polaroid. */
export function ArtistTile({ artist, showFollow = true, rank }: { artist: ArtistCard; showFollow?: boolean; rank?: number }) {
  const meta = [
    artist.isGroup ? (artist.groupKind || 'Group') : null,
    artist.region?.name,
    artist.views ? plural(artist.views.week, 'view') + ' this week' : plural(artist._count.followers, 'follower'),
  ];
  return (
    <div className="group">
      <Link
        to={`/artists/${artist.slug}`}
        className={`tape relative block border border-ink/10 bg-surface p-2.5 pb-3 shadow-hard-sm transition duration-200 group-hover:-translate-y-1 group-hover:rotate-0 group-hover:shadow-hard ${tiltFor(artist.slug)}`}
      >
        {rank !== undefined && (
          <span
            className={`display absolute -top-3 -left-3 z-10 grid size-12 place-items-center border-2 border-ink text-3xl shadow-hard-sm ${
              rank === 1 ? 'bg-saffron' : rank <= 3 ? 'bg-neon' : 'bg-surface'
            }`}
            aria-label={`Rank ${rank}`}
          >
            {rank}
          </span>
        )}
        <Artwork src={artist.imageUrl} name={artist.name} seed={artist.slug} />
        <div className="mt-2.5 flex items-center gap-1">
          <h3 className="display truncate text-xl">{artist.name}</h3>
          {artist.verified && <BadgeCheck size={16} className="shrink-0 text-saffron" aria-label="Verified" />}
        </div>
        <p className="mono truncate !text-[10px] text-muted">{meta.filter(Boolean).join(' · ')}</p>
      </Link>
      {showFollow && (
        <div className="mt-3 flex items-center gap-2">
          <FollowButton slug={artist.slug} isFollowing={artist.isFollowing} size="sm" />
          {artist.instagramUrl && <InstagramLink url={artist.instagramUrl} compact />}
        </div>
      )}
    </div>
  );
}

/** Square sleeve with a record that slides out on hover. */
function Sleeve({ children, badge }: { children: ReactNode; badge?: ReactNode }) {
  return (
    <div className="relative mr-[12%]">
      <div
        aria-hidden
        className="absolute inset-y-[5%] right-0 aspect-square rounded-full transition-transform duration-300 group-hover:translate-x-[22%]"
        style={{
          background:
            'radial-gradient(circle, #f05a0a 0 14%, #16130f 14.5% 16%, #2a2622 16.5% 30%, #16130f 30.5% 31%, #2a2622 31.5% 45%, #16130f 45.5% 46%, #2a2622 46.5% 70%, #16130f 70.5%)',
        }}
      />
      <div className="relative border-2 border-ink bg-surface shadow-hard transition duration-200 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5">
        {children}
        {badge && <div className="absolute top-2 left-0">{badge}</div>}
        <span className="absolute right-2 bottom-2 grid size-9 place-items-center border-2 border-ink bg-saffron opacity-0 transition group-hover:opacity-100">
          <Play size={16} fill="currentColor" />
        </span>
      </div>
    </div>
  );
}

const yearBadge = (y: number | null) =>
  y ? <span className="mono bg-ink px-1.5 py-0.5 !text-[9px] text-paper">{y}</span> : null;

export function SongTile({ song }: { song: SongCard }) {
  const cover = song.coverUrl ?? song.album?.coverUrl;
  return (
    <Link to={`/songs/${song.slug}`} className="group block">
      <Sleeve badge={yearBadge(year(song.releaseDate))}>
        <Artwork src={cover} name={song.title} seed={song.slug} />
      </Sleeve>
      <h3 className="mt-3 line-clamp-2 text-sm leading-tight font-bold uppercase group-hover:underline">{song.title}</h3>
      <ArtistCredits artist={song.artist} features={song.features} className="block" />
    </Link>
  );
}

export function AlbumTile({ album }: { album: AlbumCard }) {
  return (
    <Link to={`/albums/${album.slug}`} className="group block">
      <Sleeve badge={yearBadge(year(album.releaseDate))}>
        <Artwork src={album.coverUrl} name={album.title} seed={album.slug} />
      </Sleeve>
      <h3 className="mt-3 truncate text-sm font-bold uppercase group-hover:underline">{album.title}</h3>
      <p className="mono !text-[10px] text-muted">
        {album.type} · {plural(album._count.songs, 'track')}
      </p>
    </Link>
  );
}

export function PlaylistTile({ playlist }: { playlist: PlaylistCard }) {
  const covers = playlist.songs.map((s) => s.song.coverUrl ?? s.song.album?.coverUrl).filter(Boolean) as string[];
  return (
    <Link to={`/playlists/${playlist.id}`} className="group block">
      <Sleeve>
        {covers.length >= 4 ? (
          <div className="halftone grid aspect-square grid-cols-2">
            {covers.slice(0, 4).map((c, i) => (
              <img key={i} src={c} alt="" className="size-full object-cover" />
            ))}
          </div>
        ) : (
          <div className="halftone grid aspect-square place-items-center bg-saffron">
            <ListMusic size={44} className="text-ink" />
          </div>
        )}
      </Sleeve>
      <h3 className="mt-3 truncate text-sm font-bold uppercase group-hover:underline">{playlist.name}</h3>
      <p className="mono !text-[10px] text-muted">{plural(playlist._count.songs, 'song')}</p>
    </Link>
  );
}

/** Chart-style track row used on artist pages, catalog, album & playlist views. */
export function SongRow({
  song,
  index,
  showAlbum = true,
  extra,
}: {
  song: SongCard;
  index?: number;
  showAlbum?: boolean;
  extra?: ReactNode;
}) {
  const cover = song.coverUrl ?? song.album?.coverUrl;
  const compactRow = index === undefined && !showAlbum;
  const cols = compactRow
    ? 'md:grid-cols-[minmax(0,1fr)_3rem_auto]'
    : 'md:grid-cols-[3rem_minmax(0,3fr)_minmax(0,2fr)_auto]';
  return (
    <div
      className={`group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-dashed border-ink/25 px-2 py-2.5 transition last:border-b-0 hover:bg-neon/50 ${cols}`}
    >
      {!compactRow && (
        <span className="display hidden text-center text-3xl text-ink/80 tabular-nums md:block">
          {index !== undefined ? String(index).padStart(2, '0') : ''}
        </span>
      )}
      <Link to={`/songs/${song.slug}`} className="flex min-w-0 items-center gap-3">
        <div className="size-12 shrink-0 border-2 border-ink">
          <Artwork src={cover} name={song.title} seed={song.slug} />
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-2 truncate text-sm font-bold uppercase">
            <span className="truncate">{song.title}</span>
            {song.explicit && <span className="mono border border-ink px-1 !text-[9px]">E</span>}
          </p>
          <ArtistCredits artist={song.artist} features={song.features} className="block" />
        </div>
      </Link>
      <div className="mono hidden min-w-0 text-muted md:block">
        {showAlbum && song.album ? (
          <Link to={`/albums/${song.album.slug}`} className="block truncate hover:text-ink hover:underline">
            {song.album.title}
          </Link>
        ) : (
          <span>{year(song.releaseDate) ?? ''}</span>
        )}
      </div>
      <div className="flex items-center gap-0.5">
        <LikeButton slug={song.slug} isLiked={song.isLiked} />
        <AddToPlaylistButton songId={song.id} />
        <span className="mono hidden w-12 text-right text-muted tabular-nums sm:block">{duration(song.durationSec) ?? ''}</span>
        {extra}
      </div>
    </div>
  );
}

/** Frame for a list of SongRows. */
export function TrackList({ children }: { children: ReactNode }) {
  return <div className="border-2 border-ink bg-surface px-1 shadow-hard">{children}</div>;
}
