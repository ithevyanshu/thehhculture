import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link2, Unlink, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useArtists } from '../../lib/queries';
import { Artwork } from '../../components/Artwork';
import { useDialog } from '../../components/Dialog';
import { Empty, Pagination, Spinner } from '../../components/ui';
import { CHANGE_ACTION_LABEL, type ArtistChange, type ArtistChangeStatus, type ArtistRef, type Paged } from '../../lib/types';

type AutoPublish = { profile: boolean; releases: boolean; posts: boolean };
type UserRef = { id: string; username: string; displayName: string; email: string; role: string };

interface ReviewItem extends ArtistChange {
  artistId: string;
  artist: ArtistRef;
  author: UserRef | null;
  reviewedBy: { username: string } | null;
  /** Live values of the fields a pending update would change. */
  current: Record<string, unknown> | null;
}

/** Friendly names for payload fields. */
const FIELD_LABEL: Record<string, string> = {
  name: 'Name',
  handle: '@handle',
  realName: 'Real name',
  activeSince: 'Active since',
  bio: 'Bio',
  imageUrl: 'Photo',
  imageCredit: 'Photo credit',
  bannerUrl: 'Banner',
  regionSlug: 'City',
  genreSlugs: 'Genres',
  instagramUrl: 'Instagram',
  youtubeUrl: 'YouTube',
  spotifyUrl: 'Spotify',
  title: 'Title',
  type: 'Type',
  releaseDate: 'Release date',
  coverUrl: 'Cover',
  spotifyId: 'Spotify album',
  albumId: 'Album',
  trackNumber: 'Track #',
  durationSec: 'Duration (s)',
  explicit: 'Explicit',
  featureArtistIds: 'Featuring',
  producerArtistIds: 'Produced by',
  spotifyTrackId: 'Spotify track',
  youtubeVideoId: 'YouTube video',
  lyricsUrl: 'Lyrics',
  text: 'Text',
  linkUrl: 'Link',
};

function show(key: string, value: unknown, names: Record<string, string>) {
  if (value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)) return <span className="text-dim">-</span>;
  if (Array.isArray(value)) return value.map((v) => names[String(v)] ?? String(v)).join(', ');
  if (key === 'albumId') return names[String(value)] ?? String(value);
  if (key === 'releaseDate') return String(value).slice(0, 10);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  const s = String(value);
  if (/^https?:\/\//.test(s)) {
    return (
      <a href={s} target="_blank" rel="noreferrer" className="break-all text-saffron-soft underline">
        {s}
      </a>
    );
  }
  return <span className="whitespace-pre-line">{s}</span>;
}

// ---------- Settings ----------

function SettingsPanel() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'studio', 'settings'], queryFn: () => api<{ autoPublish: AutoPublish }>('/admin/studio/settings') });
  const [v, setV] = useState<AutoPublish | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  useEffect(() => {
    if (data) setV(data.autoPublish);
  }, [data]);
  if (!v) return <Spinner />;

  const save = async () => {
    setStatus(null);
    try {
      await api('/admin/studio/settings', { method: 'PUT', body: { autoPublish: v } });
      setStatus('Saved');
      qc.invalidateQueries({ queryKey: ['admin', 'studio'] });
    } catch (err) {
      setStatus(err instanceof ApiError ? err.message : 'Save failed');
    }
  };

  const rows: { key: keyof AutoPublish; label: string; hint: string }[] = [
    { key: 'profile', label: 'Profile edits', hint: 'Bio, photo, links, city, genres, @handle' },
    { key: 'releases', label: 'Songs & releases', hint: 'Adding, editing and removing songs, albums, EPs' },
    { key: 'posts', label: 'Posts', hint: "Short updates on their page and in followers' feeds" },
  ];
  return (
    <section className="border-2 border-ink bg-surface shadow-hard">
      <header className="border-b-2 border-ink bg-paper px-5 py-3">
        <h2 className="display text-3xl">What goes live without review</h2>
        <p className="text-sm text-muted">Ticked kinds publish straight away (still logged below). Unticked kinds wait for approval.</p>
      </header>
      <div className="space-y-3 p-5">
        {rows.map((r) => (
          <label key={r.key} className="flex items-start gap-3">
            <input type="checkbox" className="mt-1" checked={v[r.key]} onChange={(e) => setV({ ...v, [r.key]: e.target.checked })} />
            <span>
              <b>{r.label}</b> <span className="text-sm text-muted">· {r.hint}</span>
              <span className={`mono ml-2 ${v[r.key] ? 'text-saffron-soft' : 'text-muted'}`}>{v[r.key] ? 'Auto-publish' : 'Needs approval'}</span>
            </span>
          </label>
        ))}
      </div>
      <footer className="flex items-center gap-3 border-t-2 border-dashed border-ink/30 px-5 py-3">
        <button className="btn-primary" onClick={save}>
          Save
        </button>
        {status && <span className="text-sm text-muted">{status}</span>}
      </footer>
    </section>
  );
}

// ---------- Review queue ----------

function ChangeCard({ c, names, onDone }: { c: ReviewItem; names: Record<string, string>; onDone: () => void }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keys = Object.keys(c.payload);
  const isDelete = c.action.endsWith('_DELETE');

  const act = async (path: 'approve' | 'reject') => {
    setBusy(true);
    setError(null);
    try {
      await api(`/admin/studio/changes/${c.id}/${path}`, { method: 'POST', body: path === 'reject' ? { note } : undefined });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="border-2 border-ink bg-surface shadow-hard-sm">
      <header className="flex flex-wrap items-center gap-3 border-b-2 border-ink bg-paper px-4 py-2">
        <div className="size-9 border border-ink">
          <Artwork src={c.artist.imageUrl ?? null} name={c.artist.name} seed={c.artist.slug} live />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold uppercase">
            {c.artist.name} <span className="mono ml-1 bg-neon px-1 normal-case">{CHANGE_ACTION_LABEL[c.action]}</span>
          </p>
          <p className="mono truncate text-muted">
            {c.summary} · by @{c.author?.username ?? 'deleted account'} · {new Date(c.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
          </p>
        </div>
        {c.status !== 'PENDING' && (
          <span className="mono text-muted">
            {c.status === 'APPLIED' ? (c.reviewedBy ? `Approved by @${c.reviewedBy.username}` : 'Auto-published') : `Rejected by @${c.reviewedBy?.username ?? '?'}`}
          </span>
        )}
      </header>

      <div className="overflow-x-auto p-4">
        {isDelete ? (
          <p className="font-semibold text-red">Remove “{c.summary}” from the catalog.</p>
        ) : keys.length ? (
          <table className="w-full text-left text-sm">
            <thead className="mono text-muted">
              <tr>
                <th className="w-36 py-1 pr-3">Field</th>
                {c.current && <th className="py-1 pr-3">Now</th>}
                <th className="py-1">{c.current ? 'Proposed' : 'Value'}</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k} className="border-t border-dashed border-ink/20 align-top">
                  <td className="mono py-1.5 pr-3">{FIELD_LABEL[k] ?? k}</td>
                  {c.current && <td className="max-w-xs py-1.5 pr-3 text-muted">{show(k, c.current[k], names)}</td>}
                  <td className="max-w-xs py-1.5 font-semibold">{show(k, c.payload[k], names)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-muted">No fields.</p>
        )}
        {c.reviewNote && <p className="mt-3 text-sm">Note: {c.reviewNote}</p>}
      </div>

      {c.status === 'PENDING' && (
        <footer className="space-y-2 border-t-2 border-dashed border-ink/30 px-4 py-3">
          {rejecting && (
            <textarea
              className="input min-h-16"
              maxLength={500}
              placeholder="Optional note for the artist (they'll see it in their Studio)"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              autoFocus
            />
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!rejecting ? (
              <>
                <button className="btn-primary" disabled={busy} onClick={() => act('approve')}>
                  <Check size={14} /> Approve & publish
                </button>
                <button className="btn-ghost" disabled={busy} onClick={() => setRejecting(true)}>
                  <X size={14} /> Reject…
                </button>
              </>
            ) : (
              <>
                <button className="btn bg-red text-paper" disabled={busy} onClick={() => act('reject')}>
                  Reject
                </button>
                <button className="btn-ghost" onClick={() => setRejecting(false)}>
                  Cancel
                </button>
              </>
            )}
            {error && <span className="text-sm text-red">{error}</span>}
          </div>
        </footer>
      )}
    </article>
  );
}

function Queue() {
  const qc = useQueryClient();
  const [status, setStatus] = useState<ArtistChangeStatus>('PENDING');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'studio', 'changes', status, page],
    queryFn: () =>
      api<Paged<ReviewItem> & { pending: number; names: Record<string, string> }>('/admin/studio/changes', { query: { status, page, limit: 20 } }),
    placeholderData: (prev) => prev,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['admin', 'studio'] });
    qc.invalidateQueries({ queryKey: ['artist'] });
    qc.invalidateQueries({ queryKey: ['home'] });
  };

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <h2 className="display mr-2 text-3xl">Changes</h2>
        {(['PENDING', 'APPLIED', 'REJECTED'] as ArtistChangeStatus[]).map((s) => (
          <button
            key={s}
            className={`chip ${status === s ? 'chip-active' : ''}`}
            onClick={() => {
              setStatus(s);
              setPage(1);
            }}
          >
            {s === 'PENDING' ? `To review${data?.pending ? ` (${data.pending})` : ''}` : s === 'APPLIED' ? 'Live' : 'Rejected'}
          </button>
        ))}
      </div>
      {isLoading || !data ? (
        <Spinner />
      ) : data.items.length ? (
        <div className="space-y-4">
          {data.items.map((c) => (
            <ChangeCard key={c.id} c={c} names={data.names} onDone={refresh} />
          ))}
          <Pagination meta={data.meta} onPage={setPage} />
        </div>
      ) : (
        <Empty title={status === 'PENDING' ? 'All caught up' : 'Nothing here'} />
      )}
    </section>
  );
}

// ---------- Links ----------

function LinkForm({ onDone }: { onDone: () => void }) {
  const [artistQ, setArtistQ] = useState('');
  const [userQ, setUserQ] = useState('');
  const [artist, setArtist] = useState<ArtistRef | null>(null);
  const [user, setUser] = useState<UserRef | null>(null);
  const [error, setError] = useState<string | null>(null);
  const artists = useArtists({ q: artistQ, limit: 6 }, artistQ.trim().length > 0 && !artist);
  const users = useQuery({
    queryKey: ['admin', 'studio', 'users', userQ],
    queryFn: () => api<{ items: (UserRef & { managedArtist: { name: string } | null })[] }>('/admin/studio/users', { query: { q: userQ } }),
    enabled: userQ.trim().length > 0 && !user,
  });

  const link = async () => {
    if (!artist || !user) return;
    setError(null);
    try {
      await api(`/admin/studio/links/${artist.id}`, { method: 'PUT', body: { userId: user.id } });
      setArtist(null);
      setUser(null);
      setArtistQ('');
      setUserQ('');
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not link');
    }
  };

  const picked = (label: string, clear: () => void) => (
    <div className="flex items-center gap-2 border-2 border-ink bg-paper px-3 py-2">
      <b className="flex-1 truncate">{label}</b>
      <button aria-label="Change" onClick={clear}>
        <X size={14} />
      </button>
    </div>
  );

  return (
    <div className="grid items-end gap-3 border-2 border-dashed border-ink bg-paper p-4 md:grid-cols-[1fr_1fr_auto]">
      <div className="relative">
        <span className="label">Artist profile</span>
        {artist ? (
          picked(artist.name, () => setArtist(null))
        ) : (
          <>
            <input className="input" placeholder="Search artists…" value={artistQ} onChange={(e) => setArtistQ(e.target.value)} />
            {!!artistQ.trim() && !!artists.data?.items.length && (
              <ul className="absolute z-20 mt-1 w-full border-2 border-ink bg-surface shadow-hard">
                {artists.data.items.map((a) => (
                  <li key={a.id}>
                    <button className="w-full px-3 py-1.5 text-left hover:bg-neon" onClick={() => setArtist(a)}>
                      <b className="uppercase">{a.name}</b> <span className="text-xs text-muted">@{a.handle}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <div className="relative">
        <span className="label">Account</span>
        {user ? (
          picked(`@${user.username}`, () => setUser(null))
        ) : (
          <>
            <input className="input" placeholder="Username or email…" value={userQ} onChange={(e) => setUserQ(e.target.value)} />
            {!!userQ.trim() && !!users.data?.items.length && (
              <ul className="absolute z-20 mt-1 w-full border-2 border-ink bg-surface shadow-hard">
                {users.data.items.map((u) => (
                  <li key={u.id}>
                    <button
                      className="w-full px-3 py-1.5 text-left hover:bg-neon disabled:opacity-40"
                      disabled={!!u.managedArtist}
                      onClick={() => setUser(u)}
                      title={u.managedArtist ? `Already runs ${u.managedArtist.name}` : undefined}
                    >
                      <b>@{u.username}</b> <span className="text-xs text-muted">{u.email}</span>
                      {u.managedArtist && <span className="text-xs text-muted"> · runs {u.managedArtist.name}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      <button className="btn-primary" disabled={!artist || !user} onClick={link}>
        <Link2 size={14} /> Link
      </button>
      {error && <p className="text-sm text-red md:col-span-3">{error}</p>}
    </div>
  );
}

function Links() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const { data } = useQuery({
    queryKey: ['admin', 'studio', 'links'],
    queryFn: () => api<{ items: (ArtistRef & { managedBy: UserRef })[] }>('/admin/studio/links'),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['admin'] });

  const unlink = async (a: ArtistRef & { managedBy: UserRef }) => {
    if (!(await dialog.confirm(`Unlink @${a.managedBy.username} from ${a.name}? They lose Studio access; pending changes stay in the queue.`, { confirmLabel: 'Unlink' })))
      return;
    await api(`/admin/studio/links/${a.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <section>
      <h2 className="display mb-1 text-3xl">Linked accounts</h2>
      <p className="mb-4 text-sm text-muted">
        One account per artist. Verify who's asking first (official email or Instagram DM) before linking.
      </p>
      <LinkForm onDone={refresh} />
      <div className="mt-4">
        {!data ? (
          <Spinner />
        ) : data.items.length ? (
          <div className="border-2 border-ink bg-surface">
            {data.items.map((a) => (
              <div key={a.id} className="flex items-center gap-3 border-b border-dashed border-ink/25 px-3 py-2 last:border-b-0">
                <div className="size-9 shrink-0 border border-ink">
                  <Artwork src={a.imageUrl ?? null} name={a.name} seed={a.slug} live />
                </div>
                <b className="flex-1 truncate uppercase">{a.name}</b>
                <span className="truncate text-sm text-muted">
                  @{a.managedBy.username} · {a.managedBy.email}
                </span>
                <button className="mono flex items-center gap-1 border-2 border-ink px-2 py-1 hover:bg-neon" onClick={() => unlink(a)}>
                  <Unlink size={12} /> Unlink
                </button>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No artist accounts yet" />
        )}
      </div>
    </section>
  );
}

export function StudioAdmin() {
  return (
    <div className="space-y-12">
      <Queue />
      <Links />
      <SettingsPanel />
    </div>
  );
}
