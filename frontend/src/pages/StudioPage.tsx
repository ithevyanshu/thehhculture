import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Clock, Eye, Heart, Mic, Pencil, Plus, Trash2, Users, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../auth/AuthContext';
import { compact, year } from '../lib/format';
import { Artwork } from '../components/Artwork';
import { useDialog } from '../components/Dialog';
import { Empty, Pagination, Spinner } from '../components/ui';
import { AlbumForm, ArtistForm, Drawer, SongForm, type SubmitResult } from './admin/CatalogForms';
import {
  CHANGE_ACTION_LABEL,
  CHANGE_STATUS_LABEL,
  type AlbumCard,
  type ArtistChange,
  type ArtistPost,
  type Paged,
  type SongCard,
} from '../lib/types';

type Tab = 'Overview' | 'Profile' | 'Releases' | 'Posts' | 'Activity';
type AutoPublish = { profile: boolean; releases: boolean; posts: boolean };
type Notice = { ok: boolean; msg: string } | null;

interface StudioInfo {
  artist: { id: string; slug: string; name: string; imageUrl: string | null };
  pending: number;
  autoPublish: AutoPublish;
}

interface Stats {
  followers: { total: number; last7: number; last30: number };
  views: { allTime: number; week: number; daily: { day: string; count: number }[] };
  likes: number;
  songs: { id: string; slug: string; title: string; releaseDate: string | null; likes: number; playlists: number }[];
}

/** "Live now" or "sent for review", depending on what the server did. */
function resultNotice(result: SubmitResult, what: string): Notice {
  if (!result?.status) return null;
  return result.status === 'APPLIED'
    ? { ok: true, msg: `${what} is live.` }
    : { ok: true, msg: `${what} was sent for review. You'll see it under Activity, and it goes live once approved.` };
}

function ReviewNote({ auto, what }: { auto: boolean; what: string }) {
  return (
    <p className="mono mb-4 flex items-center gap-1.5 text-muted">
      {auto ? <CheckCircle2 size={12} /> : <Clock size={12} />}
      {auto ? `${what} go live immediately` : `${what} are reviewed by the DHH/CULTURE team before going live`}
    </p>
  );
}

// ---------- Overview ----------

function StatCard({ icon, value, label, sub }: { icon: React.ReactNode; value: number; label: string; sub?: string }) {
  return (
    <div className="border-2 border-ink bg-surface p-4 shadow-hard-sm">
      <p className="mono flex items-center gap-1.5 text-muted">
        {icon} {label}
      </p>
      <p className="display mt-1 text-5xl">{compact(value)}</p>
      {sub && <p className="mono mt-1 text-saffron-soft">{sub}</p>}
    </div>
  );
}

function Overview() {
  const { data } = useQuery({ queryKey: ['studio', 'stats'], queryFn: () => api<Stats>('/studio/stats') });
  if (!data) return <Spinner />;
  const max = Math.max(1, ...data.views.daily.map((d) => d.count));
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<Users size={12} />} value={data.followers.total} label="Followers" sub={`+${data.followers.last7} this week · +${data.followers.last30} in 30 days`} />
        <StatCard icon={<Eye size={12} />} value={data.views.week} label="Profile views, 7 days" />
        <StatCard icon={<Eye size={12} />} value={data.views.allTime} label="Profile views, all time" />
        <StatCard icon={<Heart size={12} />} value={data.likes} label="Song likes" />
      </div>

      <section className="border-2 border-ink bg-surface p-4 shadow-hard-sm">
        <p className="label">Profile views, last 30 days</p>
        {data.views.daily.length ? (
          <div className="flex h-32 items-end gap-1" role="img" aria-label="Daily profile views for the last 30 days">
            {data.views.daily.map((d) => (
              <div key={d.day} className="flex-1 bg-saffron" style={{ height: `${Math.max(4, (d.count / max) * 100)}%` }} title={`${d.day}: ${d.count}`} />
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No views recorded yet. Share your page to get the numbers moving.</p>
        )}
      </section>

      <section>
        <p className="label">Your songs by likes</p>
        {data.songs.length ? (
          <div className="border-2 border-ink bg-surface">
            {data.songs.map((s, i) => (
              <div key={s.id} className="flex items-center gap-3 border-b border-dashed border-ink/25 px-3 py-2 last:border-b-0">
                <span className="display w-8 text-2xl text-muted">{String(i + 1).padStart(2, '0')}</span>
                <Link to={`/songs/${s.slug}`} className="min-w-0 flex-1 truncate font-bold uppercase hover:underline">
                  {s.title}
                </Link>
                <span className="mono text-muted">{year(s.releaseDate)}</span>
                <span className="mono w-20 text-right">
                  <Heart size={11} className="inline" /> {s.likes}
                </span>
                <span className="mono hidden w-28 text-right text-muted sm:inline">{s.playlists} playlists</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty title="No songs yet" />
        )}
      </section>
    </div>
  );
}

// ---------- Releases ----------

type Editing = { kind: 'album' | 'song'; id: string | null } | null;

function Releases({ artistId, auto, notify }: { artistId: string; auto: boolean; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [editing, setEditing] = useState<Editing>(null);
  const songs = useQuery({ queryKey: ['studio', 'songs'], queryFn: () => api<{ items: SongCard[] }>('/studio/songs') });
  const albums = useQuery({ queryKey: ['studio', 'albums'], queryFn: () => api<{ items: AlbumCard[] }>('/studio/albums') });

  const done = (what: string) => (result: SubmitResult) => {
    setEditing(null);
    notify(resultNotice(result, what));
    qc.invalidateQueries({ queryKey: ['studio'] });
    qc.invalidateQueries({ queryKey: ['artist'] });
  };

  const remove = async (kind: 'songs' | 'albums', id: string, title: string) => {
    const what = kind === 'songs' ? 'song' : 'release';
    if (!(await dialog.confirm(`Remove the ${what} "${title}"?${auto ? '' : ' An admin will review this first.'}`, { confirmLabel: 'Remove' }))) return;
    try {
      done(`The removal of "${title}"`)(await api<SubmitResult>(`/studio/${kind}/${id}`, { method: 'DELETE' }));
    } catch (err) {
      notify({ ok: false, msg: err instanceof ApiError ? err.message : 'Could not remove it' });
    }
  };

  const row = (key: string, image: React.ReactNode, title: string, subtitle: string, onEdit: () => void, onDelete: () => void) => (
    <div key={key} className="flex items-center gap-3 border-b border-dashed border-ink/25 px-3 py-2 last:border-b-0">
      <div className="size-10 shrink-0 border border-ink">{image}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold uppercase">{title}</p>
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>
      <button onClick={onEdit} className="p-2 hover:bg-neon" aria-label={`Edit ${title}`}>
        <Pencil size={16} />
      </button>
      <button onClick={onDelete} className="p-2 hover:bg-neon hover:text-red" aria-label={`Remove ${title}`}>
        <Trash2 size={16} />
      </button>
    </div>
  );

  return (
    <div className="space-y-10">
      <ReviewNote auto={auto} what="Song and release changes" />
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-3xl">Songs</h2>
          <button className="btn-primary" onClick={() => setEditing({ kind: 'song', id: null })}>
            <Plus size={14} /> New song
          </button>
        </div>
        {!songs.data ? (
          <Spinner />
        ) : songs.data.items.length ? (
          <div className="border-2 border-ink bg-surface">
            {songs.data.items.map((s) =>
              row(
                s.id,
                <Artwork src={s.coverUrl ?? s.album?.coverUrl} name={s.title} seed={s.slug} />,
                s.title,
                [s.album?.title ?? 'Single', year(s.releaseDate), s.features.length ? `ft. ${s.features.map((f) => f.artist.name).join(', ')}` : ''].filter(Boolean).join(' · '),
                () => setEditing({ kind: 'song', id: s.id }),
                () => remove('songs', s.id, s.title),
              ),
            )}
          </div>
        ) : (
          <Empty title="No songs yet">Add your first track.</Empty>
        )}
        <p className="mt-2 text-xs text-dim">Songs you're featured on belong to the main artist, so they're not editable here.</p>
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="display text-3xl">Albums, EPs & mixtapes</h2>
          <button className="btn-ghost" onClick={() => setEditing({ kind: 'album', id: null })}>
            <Plus size={14} /> New release
          </button>
        </div>
        {!albums.data ? (
          <Spinner />
        ) : albums.data.items.length ? (
          <div className="border-2 border-ink bg-surface">
            {albums.data.items.map((a) =>
              row(
                a.id,
                <Artwork src={a.coverUrl} name={a.title} seed={a.slug} />,
                a.title,
                [a.type, year(a.releaseDate), `${a._count.songs} tracks`].filter(Boolean).join(' · '),
                () => setEditing({ kind: 'album', id: a.id }),
                () => remove('albums', a.id, a.title),
              ),
            )}
          </div>
        ) : (
          <Empty title="No releases yet">Singles don't need one. Add an album or EP to group tracks.</Empty>
        )}
      </section>

      {editing && (
        <Drawer title={`${editing.id ? 'Edit' : 'New'} ${editing.kind === 'song' ? 'song' : 'release'}`} onClose={() => setEditing(null)}>
          {editing.kind === 'song' ? (
            <SongForm id={editing.id} studio={{ artistId }} onDone={done(editing.id ? 'Your song edit' : 'Your new song')} />
          ) : (
            <AlbumForm id={editing.id} studio={{ artistId }} onDone={done(editing.id ? 'Your release edit' : 'Your new release')} />
          )}
        </Drawer>
      )}
    </div>
  );
}

// ---------- Posts ----------

function Posts({ slug, auto, notify }: { slug: string; auto: boolean; notify: (n: Notice) => void }) {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [draft, setDraft] = useState({ text: '', linkUrl: '' });
  const [busy, setBusy] = useState(false);
  const posts = useQuery({ queryKey: ['studio', 'posts'], queryFn: () => api<{ items: ArtistPost[] }>('/studio/posts') });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['studio'] });
    qc.invalidateQueries({ queryKey: ['artist', slug] });
    qc.invalidateQueries({ queryKey: ['home'] });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const result = await api<SubmitResult>('/studio/posts', { method: 'POST', body: draft });
      setDraft({ text: '', linkUrl: '' });
      notify(resultNotice(result, 'Your post'));
      refresh();
    } catch (err) {
      notify({ ok: false, msg: err instanceof ApiError ? err.message : 'Could not post' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: ArtistPost) => {
    if (!(await dialog.confirm('Take this post down?', { confirmLabel: 'Delete post' }))) return;
    await api(`/studio/posts/${p.id}`, { method: 'DELETE' });
    refresh();
  };

  return (
    <div>
      <ReviewNote auto={auto} what="Posts" />
      <form onSubmit={submit} className="mb-8 space-y-3 border-2 border-ink bg-surface p-4 shadow-hard">
        <label className="label" htmlFor="post-text">
          New post
        </label>
        <textarea
          id="post-text"
          className="input min-h-24"
          maxLength={280}
          placeholder="New drop Friday. Tour dates. Studio news…"
          value={draft.text}
          onChange={(e) => setDraft({ ...draft, text: e.target.value })}
          required
        />
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="input !w-auto min-w-64 flex-1"
            placeholder="Link (optional): /songs/… or https://…"
            value={draft.linkUrl}
            onChange={(e) => setDraft({ ...draft, linkUrl: e.target.value })}
          />
          <span className="mono text-muted">{280 - draft.text.length}</span>
          <button className="btn-primary" disabled={busy || !draft.text.trim()}>
            {busy ? 'Posting…' : auto ? 'Post' : 'Send for review'}
          </button>
        </div>
        <p className="text-xs text-dim">Posts show on your artist page and in your followers' "From the artists" feed for 30 days.</p>
      </form>

      {!posts.data ? (
        <Spinner />
      ) : posts.data.items.length ? (
        <ul className="space-y-3">
          {posts.data.items.map((p) => (
            <li key={p.id} className="flex items-start gap-3 border-2 border-ink bg-surface p-4">
              <div className="min-w-0 flex-1">
                <p className="whitespace-pre-line">{p.text}</p>
                {p.linkUrl && <p className="mt-1 truncate text-sm text-saffron-soft">{p.linkUrl}</p>}
                <p className="mono mt-2 text-muted">{new Date(p.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
              </div>
              <button className="p-2 hover:bg-neon hover:text-red" aria-label="Delete post" onClick={() => remove(p)}>
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="No posts yet" />
      )}
    </div>
  );
}

// ---------- Activity ----------

const STATUS_STYLE: Record<ArtistChange['status'], string> = { PENDING: 'bg-neon', APPLIED: 'bg-surface', REJECTED: 'bg-red text-paper' };

function Activity() {
  const qc = useQueryClient();
  const dialog = useDialog();
  const [page, setPage] = useState(1);
  const { data } = useQuery({
    queryKey: ['studio', 'changes', page],
    queryFn: () => api<Paged<ArtistChange>>('/studio/changes', { query: { page, limit: 20 } }),
    placeholderData: (prev) => prev,
  });

  const withdraw = async (c: ArtistChange) => {
    if (!(await dialog.confirm(`Withdraw "${c.summary}"? It won't be reviewed.`, { confirmLabel: 'Withdraw' }))) return;
    await api(`/studio/changes/${c.id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['studio'] });
  };

  if (!data) return <Spinner />;
  if (!data.items.length) return <Empty title="Nothing yet">Your profile edits, releases and posts will show up here.</Empty>;
  return (
    <div>
      <div className="border-2 border-ink bg-surface">
        {data.items.map((c) => (
          <div key={c.id} className="flex items-start gap-3 border-b border-dashed border-ink/25 px-3 py-3 last:border-b-0">
            <span className={`mono shrink-0 border-2 border-ink px-2 py-0.5 ${STATUS_STYLE[c.status]}`}>{CHANGE_STATUS_LABEL[c.status]}</span>
            <div className="min-w-0 flex-1">
              <p className="truncate font-bold">{c.summary}</p>
              <p className="mono text-muted">
                {CHANGE_ACTION_LABEL[c.action]} · {new Date(c.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
              </p>
              {c.reviewNote && <p className="mt-1 text-sm font-semibold text-saffron-soft">Note from the team: {c.reviewNote}</p>}
            </div>
            {c.status === 'PENDING' && (
              <button className="mono flex items-center gap-1 border-2 border-ink px-2 py-1 hover:bg-neon" onClick={() => withdraw(c)}>
                <X size={12} /> Withdraw
              </button>
            )}
          </div>
        ))}
      </div>
      <Pagination meta={data.meta} onPage={setPage} />
    </div>
  );
}

// ---------- Page ----------

export function StudioPage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('Overview');
  const [notice, setNotice] = useState<Notice>(null);
  const [profileKey, setProfileKey] = useState(0);
  const { data, isLoading } = useQuery({
    queryKey: ['studio', 'info'],
    queryFn: () => api<StudioInfo>('/studio'),
    enabled: !!user?.managedArtist,
  });

  if (!user?.managedArtist) {
    return (
      <div className="mx-auto max-w-xl py-16 text-center">
        <Mic className="mx-auto" size={40} />
        <h1 className="display mt-4 text-5xl">Artist Studio</h1>
        <p className="mt-3 text-muted">
          The Studio is for artists and their teams. If you're an artist on DHH/CULTURE, write to{' '}
          <a className="font-bold text-saffron-soft underline" href="mailto:thedesihiphopculture@gmail.com">
            thedesihiphopculture@gmail.com
          </a>{' '}
          from your official email or Instagram, and we'll link your account to your profile.
        </p>
      </div>
    );
  }
  if (isLoading || !data) return <Spinner />;

  const notify = (n: Notice) => {
    setNotice(n);
    if (n) window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-6 flex items-center gap-4">
        <div className="size-20 shrink-0 border-2 border-ink">
          <Artwork src={data.artist.imageUrl} name={data.artist.name} seed={data.artist.slug} live />
        </div>
        <div className="min-w-0">
          <span className="sticker flex w-fit items-center gap-1">
            <Mic size={12} /> Artist Studio
          </span>
          <h1 className="display mt-2 truncate text-5xl md:text-6xl">{data.artist.name}</h1>
          <Link to={`/artists/${data.artist.slug}`} className="mono text-saffron-soft hover:underline">
            View your public page →
          </Link>
        </div>
      </div>

      {notice && (
        <div className={`mb-6 flex items-start gap-3 border-2 border-ink p-3 shadow-hard-sm ${notice.ok ? 'bg-neon' : 'bg-red text-paper'}`} role="status">
          <p className="flex-1 text-sm font-semibold">{notice.msg}</p>
          <button aria-label="Dismiss" onClick={() => setNotice(null)}>
            <X size={16} />
          </button>
        </div>
      )}
      {data.pending > 0 && tab !== 'Activity' && (
        <button className="mono mb-6 flex items-center gap-1.5 text-muted hover:underline" onClick={() => setTab('Activity')}>
          <Clock size={12} /> {data.pending} change{data.pending === 1 ? '' : 's'} waiting for review
        </button>
      )}

      <div className="scrollbar-none mb-8 flex gap-2 overflow-x-auto">
        {(['Overview', 'Profile', 'Releases', 'Posts', 'Activity'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`chip shrink-0 !px-4 !py-2 !text-sm ${tab === t ? 'chip-active' : ''}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview />}
      {tab === 'Profile' && (
        <div className="max-w-2xl">
          <ReviewNote auto={data.autoPublish.profile} what="Profile changes" />
          <ArtistForm
            key={profileKey}
            id={null}
            studio={{ artistId: data.artist.id }}
            onDone={(result) => {
              notify(result ? resultNotice(result, 'Your profile update') : { ok: true, msg: 'Nothing changed.' });
              setProfileKey((k) => k + 1); // reload the form with what's live now
              qc.invalidateQueries({ queryKey: ['studio'] });
              qc.invalidateQueries({ queryKey: ['artist', data.artist.slug] });
            }}
          />
        </div>
      )}
      {tab === 'Releases' && <Releases artistId={data.artist.id} auto={data.autoPublish.releases} notify={notify} />}
      {tab === 'Posts' && <Posts slug={data.artist.slug} auto={data.autoPublish.posts} notify={notify} />}
      {tab === 'Activity' && <Activity />}
    </div>
  );
}
