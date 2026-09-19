import { Check, Heart, ListPlus, Plus, UserPlus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api';
import { useMyPlaylists, useRequireLogin, useToggleFollow, useToggleLike } from '../lib/queries';
import { compact } from '../lib/format';

export function FollowButton({
  slug,
  isFollowing,
  size = 'md',
}: {
  slug: string;
  isFollowing: boolean;
  size?: 'sm' | 'md';
}) {
  const requireLogin = useRequireLogin();
  const toggle = useToggleFollow();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const following = optimistic ?? isFollowing;

  useEffect(() => { setOptimistic(null); }, [isFollowing]);

  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!requireLogin()) return;
    setOptimistic(!following);
    toggle.mutate({ slug, follow: !following }, { onError: () => setOptimistic(null) });
  };

  const cls = size === 'sm' ? '!px-3 !py-1.5 text-xs' : '';
  return (
    <button
      onClick={onClick}
      className={`${following ? 'btn-ghost' : 'btn-primary'} ${cls}`}
      aria-pressed={following}
    >
      {following ? <Check size={16} /> : <UserPlus size={16} />}
      {following ? 'Following' : 'Follow'}
    </button>
  );
}

export function LikeButton({
  slug,
  isLiked,
  count,
  showCount = false,
}: {
  slug: string;
  isLiked: boolean;
  count?: number;
  showCount?: boolean;
}) {
  const requireLogin = useRequireLogin();
  const toggle = useToggleLike();
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const liked = optimistic ?? isLiked;

  useEffect(() => { setOptimistic(null); }, [isLiked]);

  const displayCount = count !== undefined ? count + (optimistic === null ? 0 : optimistic ? 1 : -1) : undefined;

  return (
    <button
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!requireLogin()) return;
        setOptimistic(!liked);
        toggle.mutate({ slug, like: !liked }, { onError: () => setOptimistic(null) });
      }}
      aria-label={liked ? 'Unlike' : 'Like'}
      aria-pressed={liked}
      className={`inline-flex items-center gap-1.5 rounded-full p-2 transition hover:bg-ink/10 ${
        liked ? 'text-pink' : 'text-muted hover:text-bone'
      }`}
    >
      <Heart size={18} fill={liked ? 'currentColor' : 'none'} />
      {showCount && displayCount !== undefined && <span className="text-sm">{compact(Math.max(0, displayCount))}</span>}
    </button>
  );
}

/** Dropdown to add a song to one of the user's playlists (or create a new one). */
export function AddToPlaylistButton({ songId }: { songId: string }) {
  const requireLogin = useRequireLogin();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();
  const playlists = useMyPlaylists();

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const add = async (playlistId: string) => {
    await api(`/playlists/${playlistId}/songs`, { method: 'POST', body: { songId } });
    setAdded(playlistId);
    qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    qc.invalidateQueries({ queryKey: ['playlist', playlistId] });
    qc.invalidateQueries({ queryKey: ['home'] });
    setTimeout(() => setOpen(false), 600);
  };

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    const { playlist } = await api<{ playlist: { id: string } }>('/playlists', { method: 'POST', body: { name } });
    setName('');
    setCreating(false);
    await add(playlist.id);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!requireLogin()) return;
          setAdded(null);
          setOpen((o) => !o);
        }}
        aria-label="Add to playlist"
        className="rounded-full p-2 text-muted transition hover:bg-ink/10 hover:text-bone"
      >
        <ListPlus size={18} />
      </button>
      {open && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute right-0 z-30 mt-1 w-60 rounded-none border-2 border-ink bg-surface p-1.5 shadow-hard"
        >
          <p className="px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider text-dim">Add to playlist</p>
          <div className="max-h-56 overflow-y-auto">
            {playlists.data?.items.map((p) => (
              <button
                key={p.id}
                onClick={() => add(p.id)}
                className="flex w-full items-center justify-between rounded-none px-2.5 py-2 text-left text-sm hover:bg-ink/5"
              >
                <span className="truncate">{p.name}</span>
                {added === p.id && <Check size={16} className="text-saffron-soft" />}
              </button>
            ))}
            {playlists.data?.items.length === 0 && !creating && (
              <p className="px-2.5 py-1 text-sm text-muted">No playlists yet.</p>
            )}
          </div>
          {creating ? (
            <form onSubmit={create} className="mt-1 flex gap-1.5 p-1">
              <input autoFocus className="input !py-1.5" placeholder="Playlist name" value={name} onChange={(e) => setName(e.target.value)} />
              <button className="btn-primary !px-3 !py-1.5">Add</button>
            </form>
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="mt-1 flex w-full items-center gap-2 rounded-none border-t border-line px-2.5 py-2 text-sm text-saffron-soft hover:bg-ink/5"
            >
              <Plus size={16} /> New playlist
            </button>
          )}
        </div>
      )}
    </div>
  );
}
