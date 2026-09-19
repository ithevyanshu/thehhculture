import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Globe, ListMusic, Lock, Pencil, Trash2, X } from 'lucide-react';
import { api } from '../lib/api';
import { usePlaylist } from '../lib/queries';
import { plural } from '../lib/format';
import { SongRow } from '../components/Cards';
import { Empty, ErrorState, Spinner } from '../components/ui';
import { useDialog } from '../components/Dialog';

export function PlaylistPage() {
  const { id = '' } = useParams();
  const { data, isLoading, error, refetch } = usePlaylist(id);
  const qc = useQueryClient();
  const navigate = useNavigate();
  const dialog = useDialog();
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', isPublic: true });

  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorState error={error} retry={refetch} />;
  const { playlist } = data;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['playlist', id] });
    qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    qc.invalidateQueries({ queryKey: ['home'] });
  };

  const startEdit = () => {
    setForm({ name: playlist.name, description: playlist.description ?? '', isPublic: playlist.isPublic });
    setEditing(true);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    await api(`/playlists/${id}`, { method: 'PATCH', body: form });
    setEditing(false);
    refresh();
  };

  const remove = async () => {
    if (!(await dialog.confirm(`Delete "${playlist.name}"? This can't be undone.`))) return;
    await api(`/playlists/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['me', 'playlists'] });
    navigate('/library');
  };

  const removeSong = async (songId: string) => {
    await api(`/playlists/${id}/songs/${songId}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div className="mx-auto max-w-6xl">
      <section className="mb-10 flex flex-col gap-8 md:flex-row md:items-end">
        <div
          className="halftone grid aspect-square w-56 shrink-0 -rotate-1 place-items-center border-2 border-ink bg-saffron shadow-hard md:w-64"
        >
          <ListMusic size={72} className="text-ink/80" />
        </div>
        <div className="min-w-0 flex-1">
          <span className="sticker flex w-fit items-center gap-1">
            {playlist.isPublic ? <Globe size={12} /> : <Lock size={12} />} {playlist.isPublic ? 'Public' : 'Private'} playlist
          </span>
          {editing ? (
            <form onSubmit={save} className="mt-4 max-w-lg space-y-3">
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
              <input
                className="input"
                placeholder="Description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                maxLength={300}
              />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} /> Public
              </label>
              <div className="flex gap-2">
                <button className="btn-primary">Save</button>
                <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <>
              <h1 className="display mt-3 text-5xl break-words md:text-7xl">{playlist.name}</h1>
              {playlist.description && <p className="mt-2 text-muted">{playlist.description}</p>}
              <p className="mt-2 text-sm text-muted">
                by <span className="text-bone">{playlist.user.displayName}</span> · {plural(playlist._count.songs, 'song')}
              </p>
              {playlist.isOwner && (
                <div className="mt-4 flex gap-2">
                  <button onClick={startEdit} className="btn-ghost !px-4 !py-2">
                    <Pencil size={14} /> Edit
                  </button>
                  <button onClick={remove} className="btn-ghost !px-4 !py-2 hover:!border-pink hover:!text-pink">
                    <Trash2 size={14} /> Delete
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      {playlist.songs.length ? (
        <div className="border-2 border-ink bg-surface px-1 shadow-hard">
          {playlist.songs.map((s, i) => (
            <SongRow
              key={s.id}
              song={s}
              index={i + 1}
              extra={
                playlist.isOwner && (
                  <button onClick={() => removeSong(s.id)} className="rounded-full p-2 text-muted hover:bg-ink/10 hover:text-pink" aria-label="Remove from playlist">
                    <X size={16} />
                  </button>
                )
              }
            />
          ))}
        </div>
      ) : (
        <Empty title="Empty playlist">Use the + button on any song to add it here.</Empty>
      )}
    </div>
  );
}
