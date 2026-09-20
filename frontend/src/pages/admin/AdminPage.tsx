import { useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useArtists, useGenres, useRegions, useSongs } from '../../lib/queries';
import { at, year } from '../../lib/format';
import { Artwork } from '../../components/Artwork';
import { Pagination, Spinner } from '../../components/ui';
import type { AlbumCard } from '../../lib/types';
import { FrontPageAdmin } from './FrontPageAdmin';
import { AlbumForm, ArtistForm, Drawer, SongForm } from './CatalogForms';
import { InstagramGlyph, instagramHandle } from '../../components/Instagram';
import { UsersAdmin } from './UsersAdmin';
import { StudioAdmin } from './StudioAdmin';
import { ImportAdmin } from './ImportAdmin';
import { SuggestionsAdmin } from './SuggestionsAdmin';
import { ShowsAdmin } from './ShowsAdmin';
import { useDialog } from '../../components/Dialog';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import { can, type Permission } from '../../lib/permissions';

type Tab = 'Overview' | 'Front page' | 'Artists' | 'Albums' | 'Songs' | 'Import' | 'Shows' | 'Taxonomy' | 'Studio' | 'Suggestions' | 'Users';

/** Permission each tab needs (Overview is open to all staff). */
const TAB_PERMISSION: Record<Exclude<Tab, 'Overview'>, Permission> = {
  'Front page': 'frontPage',
  Artists: 'artists',
  Albums: 'albums',
  Songs: 'songs',
  Import: 'songs',
  Shows: 'shows',
  Taxonomy: 'taxonomy',
  Studio: 'studio',
  Suggestions: 'suggestions',
  Users: 'users',
};
type Editing = { kind: 'artist' | 'album' | 'song'; id: string | null } | null;

// ---------- Lists ----------

function Row({ image, title, subtitle, onEdit, onDelete }: { image: ReactNode; title: string; subtitle: string; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-none px-2 py-2 hover:bg-ink/5">
      <div className="size-10 shrink-0">{image}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{title}</p>
        <p className="truncate text-xs text-muted">{subtitle}</p>
      </div>
      <button onClick={onEdit} className="rounded-full p-2 text-muted hover:bg-ink/10 hover:text-bone" aria-label={`Edit ${title}`}>
        <Pencil size={16} />
      </button>
      <button onClick={onDelete} className="rounded-full p-2 text-muted hover:bg-ink/10 hover:text-pink" aria-label={`Delete ${title}`}>
        <Trash2 size={16} />
      </button>
    </div>
  );
}

function ListShell({
  q,
  setQ,
  onNew,
  newLabel,
  actions,
  children,
}: {
  q: string;
  setQ: (v: string) => void;
  onNew: () => void;
  newLabel: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-4 flex flex-wrap gap-2">
        <input className="input !w-72" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={onNew} className="btn-primary">
          <Plus size={16} /> {newLabel}
        </button>
        {actions}
      </div>
      <div className="border-2 border-ink bg-surface px-1 shadow-hard">{children}</div>
    </div>
  );
}

function useDelete() {
  const qc = useQueryClient();
  const dialog = useDialog();
  return async (path: string, name: string) => {
    if (!(await dialog.confirm(`Delete "${name}"? This cannot be undone.`))) return;
    try {
      await api(path, { method: 'DELETE' });
      qc.invalidateQueries();
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : 'Delete failed', 'Could not delete');
    }
  };
}

function ArtistsAdmin({ edit }: { edit: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useArtists({ q, sort: 'name', page, limit: 50 });
  const del = useDelete();
  const qc = useQueryClient();
  const dialog = useDialog();
  type Job = 'photos' | 'instagram';
  const [fetching, setFetching] = useState<Job | null>(null);
  const [report, setReport] = useState<{ job: Job; results: { artist: string; status: string; pageTitle?: string; handle?: string }[] } | null>(null);

  const runJob = async (job: Job) => {
    setFetching(job);
    setReport(null);
    try {
      const { results } = await api<{ results: { artist: string; status: string; pageTitle?: string; handle?: string }[] }>(
        job === 'photos' ? '/admin/artists/images/fetch' : '/admin/artists/instagram/fetch',
        { method: 'POST', body: { overwrite: false } },
      );
      setReport({ job, results });
      qc.invalidateQueries();
    } catch (err) {
      await dialog.alert(err instanceof Error ? err.message : 'Lookup failed', 'Lookup failed');
    } finally {
      setFetching(null);
    }
  };

  return (
    <ListShell
      q={q}
      setQ={(v) => (setQ(v), setPage(1))}
      onNew={() => edit(null)}
      newLabel="New artist"
      actions={
        <>
          <button onClick={() => runJob('photos')} className="btn-ghost" disabled={!!fetching} title="Match artists without a photo to their Wikipedia page">
            {fetching === 'photos' ? 'Fetching photos…' : 'Fetch missing photos'}
          </button>
          <button onClick={() => runJob('instagram')} className="btn-ghost" disabled={!!fetching} title="Look up official Instagram handles on Wikidata">
            <InstagramGlyph size={14} /> {fetching === 'instagram' ? 'Looking up…' : 'Fetch Instagram'}
          </button>
        </>
      }
    >
      {report && (
        <div className="mb-2 border-2 border-ink bg-surface p-3 text-sm shadow-hard-sm">
          {report.results.length === 0 ? (
            <p className="text-muted">Every artist already has {report.job === 'photos' ? 'a photo' : 'an Instagram link'}.</p>
          ) : (
            <>
              <p className="mb-1 font-semibold">
                Updated {report.results.filter((r) => r.status === 'updated').length} of {report.results.length}
                {report.job === 'instagram' &&
                  report.results.some((r) => r.handle) &&
                  `: ${report.results.flatMap((r) => (r.handle ? [`@${r.handle}`] : [])).join(', ')}`}
              </p>
              {report.results
                .filter((r) => r.status !== 'updated')
                .map((r) => (
                  <p key={r.artist} className="text-muted">
                    {r.artist}:{' '}
                    {r.status !== 'not-found'
                      ? 'lookup failed'
                      : report.job === 'photos'
                        ? 'no confident Wikipedia match, so set it manually'
                        : 'no handle on Wikidata, so add it in the artist form'}
                  </p>
                ))}
            </>
          )}
        </div>
      )}
      {!data ? (
        <Spinner />
      ) : (
        data.items.map((a) => (
          <Row
            key={a.id}
            image={<Artwork src={a.imageUrl} name={a.name} seed={a.slug} round />}
            title={a.name}
            subtitle={[
              a.region?.name,
              `${a._count.songs} songs`,
              `${a._count.followers} followers`,
              at(a),
              a.instagramUrl ? `IG @${instagramHandle(a.instagramUrl)}` : 'no Instagram',
            ]
              .filter(Boolean)
              .join(' · ')}
            onEdit={() => edit(a.id)}
            onDelete={() => del(`/admin/artists/${a.id}`, a.name)}
          />
        ))
      )}
      {data && <Pagination meta={data.meta} onPage={setPage} />}
    </ListShell>
  );
}

function AlbumsAdmin({ edit }: { edit: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const { data } = useQuery({ queryKey: ['admin', 'albums', 'list', q], queryFn: () => api<{ items: AlbumCard[] }>('/admin/albums', { query: { q } }) });
  const del = useDelete();
  return (
    <ListShell q={q} setQ={setQ} onNew={() => edit(null)} newLabel="New album">
      {!data ? (
        <Spinner />
      ) : (
        data.items.map((a) => (
          <Row
            key={a.id}
            image={<Artwork src={a.coverUrl} name={a.title} seed={a.slug} className="!rounded-none" />}
            title={a.title}
            subtitle={[a.artist.name, a.type, year(a.releaseDate), `${a._count.songs} tracks`].filter(Boolean).join(' · ')}
            onEdit={() => edit(a.id)}
            onDelete={() => del(`/admin/albums/${a.id}`, a.title)}
          />
        ))
      )}
    </ListShell>
  );
}

function SongsAdmin({ edit }: { edit: (id: string | null) => void }) {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const { data } = useSongs({ q, sort: 'new', page, limit: 50 });
  const del = useDelete();
  return (
    <ListShell q={q} setQ={(v) => (setQ(v), setPage(1))} onNew={() => edit(null)} newLabel="New song">
      {!data ? (
        <Spinner />
      ) : (
        data.items.map((s) => (
          <Row
            key={s.id}
            image={<Artwork src={s.coverUrl ?? s.album?.coverUrl} name={s.title} seed={s.slug} className="!rounded-none" />}
            title={s.title}
            subtitle={[
              s.artist.name,
              s.album?.title ?? 'Single',
              year(s.releaseDate),
              s.spotifyTrackId || s.youtubeVideoId ? '▶ embed' : 'no embed',
            ]
              .filter(Boolean)
              .join(' · ')}
            onEdit={() => edit(s.id)}
            onDelete={() => del(`/admin/songs/${s.id}`, s.title)}
          />
        ))
      )}
      {data && <Pagination meta={data.meta} onPage={setPage} />}
    </ListShell>
  );
}

function TaxonomyAdmin() {
  const genres = useGenres();
  const regions = useRegions();
  const qc = useQueryClient();
  const del = useDelete();
  const [genre, setGenre] = useState('');
  const [region, setRegion] = useState({ name: '', state: '' });

  const addGenre = async (e: FormEvent) => {
    e.preventDefault();
    await api('/admin/genres', { method: 'POST', body: { name: genre } });
    setGenre('');
    qc.invalidateQueries({ queryKey: ['genres'] });
  };
  const addRegion = async (e: FormEvent) => {
    e.preventDefault();
    await api('/admin/regions', { method: 'POST', body: region });
    setRegion({ name: '', state: '' });
    qc.invalidateQueries({ queryKey: ['regions'] });
  };

  return (
    <div className="grid gap-8 md:grid-cols-2">
      <section>
        <h3 className="display mb-3 text-2xl">Genres</h3>
        <form onSubmit={addGenre} className="mb-3 flex gap-2">
          <input className="input" placeholder="New genre" value={genre} onChange={(e) => setGenre(e.target.value)} required />
          <button className="btn-primary">Add</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {genres.data?.items.map((g) => (
            <span key={g.id} className="chip">
              {g.name} ({g._count?.songs ?? 0})
              <button onClick={() => del(`/admin/genres/${g.id}`, g.name)} aria-label={`Delete ${g.name}`} className="hover:text-pink">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </section>
      <section>
        <h3 className="display mb-3 text-2xl">Cities / regions</h3>
        <form onSubmit={addRegion} className="mb-3 flex gap-2">
          <input className="input" placeholder="City" value={region.name} onChange={(e) => setRegion({ ...region, name: e.target.value })} required />
          <input className="input" placeholder="State" value={region.state} onChange={(e) => setRegion({ ...region, state: e.target.value })} />
          <button className="btn-primary">Add</button>
        </form>
        <div className="flex flex-wrap gap-2">
          {regions.data?.items.map((r) => (
            <span key={r.id} className="chip">
              {r.name} ({r._count?.artists ?? 0})
              <button onClick={() => del(`/admin/regions/${r.id}`, r.name)} aria-label={`Delete ${r.name}`} className="hover:text-pink">
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

interface AdminStats {
  counts: Record<string, number>;
  newSuggestions: number;
  views: { week: number; allTime: number };
  topArtists: {
    week: { id: string; slug: string; name: string; imageUrl: string | null; week: number; allTime: number }[];
    allTime: { id: string; slug: string; name: string; imageUrl: string | null; week: number; allTime: number }[];
  };
}

function TopArtistList({ title, items, metric }: { title: string; items: AdminStats['topArtists']['week']; metric: 'week' | 'allTime' }) {
  return (
    <section className="border-2 border-ink bg-surface shadow-hard">
      <h3 className="display border-b-2 border-ink bg-paper px-4 py-2 text-2xl">{title}</h3>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No profile clicks yet.</p>
      ) : (
        <ol>
          {items.map((a, i) => (
            <li key={a.id} className="flex items-center gap-3 border-b border-dashed border-ink/25 px-4 py-2 last:border-b-0">
              <span className="display w-7 text-2xl">{String(i + 1).padStart(2, '0')}</span>
              <div className="size-9 shrink-0 border border-ink">
                <Artwork src={a.imageUrl} name={a.name} seed={a.slug} live />
              </div>
              <Link to={`/artists/${a.slug}`} className="flex-1 truncate font-bold uppercase hover:underline">
                {a.name}
              </Link>
              <span className="mono">{a[metric].toLocaleString('en-IN')} clicks</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Overview({ openSuggestions }: { openSuggestions?: () => void }) {
  const { data } = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<AdminStats>('/admin/stats') });
  if (!data) return <Spinner />;
  return (
    <div className="space-y-8">
      {data.newSuggestions > 0 && openSuggestions && (
        <button onClick={openSuggestions} className="flex w-full items-center justify-between border-2 border-ink bg-neon p-4 text-left shadow-hard">
          <span className="display text-2xl">
            {data.newSuggestions} new suggestion{data.newSuggestions === 1 ? '' : 's'} waiting
          </span>
          <span className="mono">Open inbox →</span>
        </button>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ['Profile clicks (7d)', data.views.week],
          ['Profile clicks (all time)', data.views.allTime],
          ...Object.entries(data.counts),
        ].map(([k, v]) => (
          <div key={k} className="border-2 border-ink bg-surface p-5 shadow-hard-sm">
            <p className="display text-4xl text-saffron">{Number(v).toLocaleString('en-IN')}</p>
            <p className="mono mt-1 text-muted">{k}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <TopArtistList title="Top artists · this week" items={data.topArtists.week} metric="week" />
        <TopArtistList title="Top artists · all time" items={data.topArtists.allTime} metric="allTime" />
      </div>
    </div>
  );
}

// ---------- Page ----------

export function AdminPage() {
  const [tab, setTab] = useState<Tab>('Overview');
  const [editing, setEditing] = useState<Editing>(null);
  const qc = useQueryClient();

  const close = () => {
    setEditing(null);
    qc.invalidateQueries();
  };

  const { user } = useAuth();
  const allTabs: Tab[] = ['Overview', 'Front page', 'Artists', 'Albums', 'Songs', 'Import', 'Shows', 'Taxonomy', 'Studio', 'Suggestions', 'Users'];
  const tabs = allTabs.filter((t) => t === 'Overview' || can(user, TAB_PERMISSION[t]));

  return (
    <div className="mx-auto max-w-6xl">
      <span className="sticker">{user?.role === 'SUB_ADMIN' ? 'Sub-admin' : 'Admin'}</span>
      <h1 className="display mt-3 mb-6 text-5xl md:text-7xl">Catalog control</h1>
      <div className="scrollbar-none mb-8 flex gap-2 overflow-x-auto">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`chip shrink-0 !px-4 !py-2 !text-sm ${tab === t ? 'chip-active' : ''}`}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && <Overview openSuggestions={can(user, 'suggestions') ? () => setTab('Suggestions') : undefined} />}
      {tab === 'Suggestions' && <SuggestionsAdmin />}
      {tab === 'Shows' && <ShowsAdmin />}
      {tab === 'Artists' && <ArtistsAdmin edit={(id) => setEditing({ kind: 'artist', id })} />}
      {tab === 'Albums' && <AlbumsAdmin edit={(id) => setEditing({ kind: 'album', id })} />}
      {tab === 'Songs' && <SongsAdmin edit={(id) => setEditing({ kind: 'song', id })} />}
      {tab === 'Taxonomy' && <TaxonomyAdmin />}
      {tab === 'Front page' && <FrontPageAdmin />}
      {tab === 'Users' && <UsersAdmin />}
      {tab === 'Studio' && <StudioAdmin />}
      {tab === 'Import' && <ImportAdmin />}

      {editing && (
        <Drawer title={`${editing.id ? 'Edit' : 'New'} ${editing.kind}`} onClose={() => setEditing(null)}>
          {editing.kind === 'artist' && <ArtistForm id={editing.id} onDone={close} />}
          {editing.kind === 'album' && <AlbumForm id={editing.id} onDone={close} />}
          {editing.kind === 'song' && <SongForm id={editing.id} onDone={close} />}
        </Drawer>
      )}
    </div>
  );
}
