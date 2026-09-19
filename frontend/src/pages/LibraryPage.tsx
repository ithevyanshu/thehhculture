import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useFollowing, useLikes, useMyPlaylists, useRecent } from '../lib/queries';
import { ArtistTile, PlaylistTile, SongRow, SongTile } from '../components/Cards';
import { Empty, Spinner } from '../components/ui';

const tabs = ['Playlists', 'Liked songs', 'Following', 'Recently viewed'] as const;
type Tab = (typeof tabs)[number];

function NewPlaylist() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const qc = useQueryClient();
  const navigate = useNavigate();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const { playlist } = await api<{ playlist: { id: string } }>('/playlists', { method: 'POST', body: { name, description: description || undefined } });
    qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    navigate(`/playlists/${playlist.id}`);
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="card grid aspect-square w-full place-items-center border-2 border-dashed border-line text-muted hover:text-bone">
        <span className="flex flex-col items-center gap-2">
          <Plus size={32} /> New playlist
        </span>
      </button>
    );
  }
  return (
    <form onSubmit={submit} className="card space-y-2">
      <input autoFocus className="input" placeholder="Playlist name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
      <input className="input" placeholder="Description (optional)" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
      <div className="flex gap-2">
        <button className="btn-primary !px-4 !py-2">Create</button>
        <button type="button" onClick={() => setOpen(false)} className="btn-ghost !px-4 !py-2">
          Cancel
        </button>
      </div>
    </form>
  );
}

export function LibraryPage() {
  const [tab, setTab] = useState<Tab>('Playlists');
  const playlists = useMyPlaylists();
  const likes = useLikes();
  const following = useFollowing();
  const recent = useRecent();
  const qc = useQueryClient();

  const grid = 'grid grid-cols-2 gap-x-5 gap-y-10 pt-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6';

  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="display mb-6 text-5xl md:text-7xl">Your library</h1>
      <div className="scrollbar-none mb-8 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`chip shrink-0 !px-4 !py-2 !text-sm ${tab === t ? 'chip-active' : ''}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Playlists' &&
        (playlists.isLoading ? (
          <Spinner />
        ) : (
          <div className={grid}>
            <NewPlaylist />
            {playlists.data?.items.map((p) => (
              <PlaylistTile key={p.id} playlist={p} />
            ))}
          </div>
        ))}

      {tab === 'Liked songs' &&
        (likes.isLoading ? (
          <Spinner />
        ) : likes.data?.items.length ? (
          <div className="border-2 border-ink bg-surface px-1 shadow-hard">
            {likes.data.items.map((s, i) => (
              <SongRow key={s.id} song={s} index={i + 1} />
            ))}
          </div>
        ) : (
          <Empty title="No liked songs yet">Tap the heart on any song to save it here.</Empty>
        ))}

      {tab === 'Following' &&
        (following.isLoading ? (
          <Spinner />
        ) : following.data?.items.length ? (
          <div className={grid}>
            {following.data.items.map((a) => (
              <ArtistTile key={a.id} artist={a} />
            ))}
          </div>
        ) : (
          <Empty title="Not following anyone yet">Follow artists to get their new drops on your home screen.</Empty>
        ))}

      {tab === 'Recently viewed' &&
        (recent.isLoading ? (
          <Spinner />
        ) : recent.data?.items.length ? (
          <>
            <div className="mb-4 flex justify-end">
              <button
                onClick={async () => {
                  await api('/me/recent', { method: 'DELETE' });
                  qc.invalidateQueries({ queryKey: ['me', 'recent'] });
                  qc.invalidateQueries({ queryKey: ['home'] });
                }}
                className="text-sm text-muted hover:text-pink"
              >
                Clear history
              </button>
            </div>
            <div className={grid}>
              {recent.data.items.map((item) =>
                item.kind === 'artist' ? (
                  <ArtistTile key={`a-${item.artist.id}`} artist={item.artist} showFollow={false} />
                ) : (
                  <SongTile key={`s-${item.song.id}`} song={item.song} />
                ),
              )}
            </div>
          </>
        ) : (
          <Empty title="Nothing here yet">Artists and songs you open will show up here.</Empty>
        ))}
    </div>
  );
}
